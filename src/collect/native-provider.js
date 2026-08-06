import { isAbsolute, resolve } from "node:path";
import { archiveOpenAIExport } from "../chat/archive.js";
import { buildChatContext, formatChatContextMarkdown } from "../chat/context.js";
import { chatIndexCounts, defaultHistoriaIndexPath, openChatIndex } from "../chat/index-storage.js";
import { indexHistoriaChats } from "../chat/indexer.js";
import { defaultHistoriaVaultPath } from "../chat/paths.js";
import {
  chatIndexHeads,
  listChatConversations,
  loadConversationSnapshot,
  searchChatIndex,
} from "../chat/search.js";
import { createCompanionVaultStore } from "../chat/companion-vault.js";
import { GitVault } from "../vault/git-writer.js";

export const HISTORIA_NATIVE_PROVIDER_PROTOCOL = "historia.native-provider/1";
export const HISTORIA_NATIVE_PROVIDER_OPERATIONS = Object.freeze([
  "history/status",
  "history/list",
  "history/search",
  "history/conversation",
  "history/import-export",
  "history/sync-status",
  "history/sync-pull",
  "history/sync-push",
  "context/build",
]);

const OPERATION_SET = new Set(HISTORIA_NATIVE_PROVIDER_OPERATIONS);
const MAX_NATIVE_RESULT_BYTES = 900 * 1024;
const MAX_QUERY_CHARS = 4096;
const MAX_PATH_CHARS = 4096;
const MAX_SEARCH_RESULTS = 50;
const MAX_CONVERSATION_MESSAGES = 200;
const MAX_CONVERSATION_CONTENT_BYTES = 512 * 1024;
const MAX_CONTEXT_BUDGET = 40_000;
const encoder = new TextEncoder();

function plainObject(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function closedKeys(value, allowed, label) {
  for (const key of Object.keys(plainObject(value, label))) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
  }
}

function text(value, label, maximum = 1024, { empty = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const output = value.trim();
  if (!empty && !output) throw new Error(`${label} cannot be empty`);
  if (output.length > maximum || /\0/u.test(output)) throw new Error(`${label} is too large or invalid`);
  return output;
}

function optionalText(value, label, maximum = 1024) {
  return value === null || value === undefined || value === "" ? null : text(value, label, maximum);
}

function integer(value, label, { minimum, maximum, fallback } = {}) {
  const source = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(source) || source < minimum || source > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return source;
}

function boolean(value, fallback = false) {
  return value === undefined || value === null ? fallback : value === true;
}

function bounded(value, label, maximum = MAX_NATIVE_RESULT_BYTES) {
  const bytes = encoder.encode(JSON.stringify(value)).byteLength;
  if (bytes > maximum) throw new Error(`${label} exceeds the native response limit (${bytes} > ${maximum})`);
  return value;
}

function truncateUtf8(value, maximumBytes) {
  const source = String(value ?? "");
  const bytes = encoder.encode(source);
  if (bytes.byteLength <= maximumBytes) return { text: source, truncated: false, bytes: bytes.byteLength };
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(source.slice(0, middle)).byteLength <= Math.max(0, maximumBytes - 3)) low = middle;
    else high = middle - 1;
  }
  const output = `${source.slice(0, low)}…`;
  return { text: output, truncated: true, bytes: encoder.encode(output).byteLength };
}

function publicProvenance(value = {}) {
  return Object.freeze({
    source_ref: value.source_ref ?? null,
    commit_oid: value.commit_oid ?? null,
    archive_sha256: value.archive_sha256 ?? null,
    observed_at: value.observed_at ?? null,
    committed_at: value.committed_at ?? null,
    manifest_path: value.manifest_path ?? null,
    message_path: value.message_path ?? null,
    node_id: value.node_id ?? null,
    active: Boolean(value.active),
    active_position: value.active_position ?? null,
  });
}

function publicSearchHit(hit) {
  const preview = truncateUtf8(hit.content ?? hit.snippet ?? "", 2048);
  return Object.freeze({
    rank: hit.rank,
    score: hit.score ?? null,
    retrieval_score: hit.retrieval_score ?? null,
    title: hit.title ?? "Untitled conversation",
    snippet: String(hit.snippet ?? preview.text).slice(0, 1200),
    content_preview: preview.text,
    content_truncated: preview.truncated,
    conversation_hid: hit.conversation_hid,
    message_hid: hit.message_hid,
    revision_oid: hit.revision_oid,
    role: hit.role,
    model: hit.model ?? null,
    created_at: hit.created_at ?? null,
    updated_at: hit.updated_at ?? null,
    provenance: publicProvenance(hit.provenance),
  });
}

function publicConversation(snapshot, { maxMessages, maxContentBytes }) {
  if (!snapshot) return null;
  const messages = [];
  let remaining = maxContentBytes;
  let truncated = false;
  for (const message of snapshot.messages.slice(0, maxMessages)) {
    const content = String(message.content_text ?? "");
    const boundedContent = truncateUtf8(content, Math.max(0, Math.min(32 * 1024, remaining)));
    remaining -= boundedContent.bytes;
    messages.push(Object.freeze({
      message_hid: message.message_hid,
      revision_oid: message.revision_oid,
      node_id: message.node_id ?? null,
      role: message.role,
      model: message.model ?? null,
      created_at: message.created_at ?? null,
      updated_at: message.updated_at ?? null,
      active: Boolean(message.active),
      active_position: message.active_position ?? null,
      content: boundedContent.text,
      content_truncated: boundedContent.truncated,
      message_path: message.message_path ?? null,
    }));
    if (boundedContent.truncated || remaining <= 0) {
      truncated = true;
      break;
    }
  }
  if (snapshot.messages.length > messages.length) truncated = true;
  return Object.freeze({
    protocol: "historia.history.conversation/1",
    conversation_hid: snapshot.conversation_hid,
    title: snapshot.title,
    created_at: snapshot.created_at ?? null,
    updated_at: snapshot.updated_at ?? null,
    observed_at: snapshot.observed_at ?? null,
    source_ref: snapshot.source_ref,
    commit_oid: snapshot.commit_oid,
    archive_sha256: snapshot.archive_sha256 ?? null,
    manifest_path: snapshot.manifest_path ?? null,
    active_paths: snapshot.active_paths ?? [],
    messages: Object.freeze(messages),
    edges: Object.freeze((snapshot.edges ?? []).slice(0, 1000)),
    truncated,
  });
}

function importPath(value) {
  const output = text(value, "OpenAI export input_path", MAX_PATH_CHARS);
  if (!isAbsolute(output)) throw new Error("OpenAI export input_path must be an absolute local path");
  return resolve(output);
}

export function createHistoriaNativeProvider({
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath),
  now = () => new Date(),
  dependencies = {},
} = {}) {
  const deps = Object.freeze({
    archiveOpenAIExport,
    buildChatContext,
    chatIndexCounts,
    chatIndexHeads,
    formatChatContextMarkdown,
    indexHistoriaChats,
    listChatConversations,
    loadConversationSnapshot,
    openChatIndex,
    searchChatIndex,
    vaultFactory: (path) => GitVault.init(path),
    ...dependencies,
  });
  const companion = dependencies.companionStore ?? createCompanionVaultStore({
    vaultPath,
    now,
    vaultFactory: deps.vaultFactory,
  });

  async function indexed(operation) {
    const index = await deps.indexHistoriaChats({ vaultPath, databasePath });
    const db = await deps.openChatIndex(databasePath);
    try {
      return { index, result: await operation(db) };
    } finally {
      db.close?.();
    }
  }

  async function historyStatus() {
    const vault = await deps.vaultFactory(vaultPath);
    const verification = await vault.verify();
    const { index, result } = await indexed((db) => ({
      counts: deps.chatIndexCounts(db),
      heads: deps.chatIndexHeads(db),
    }));
    return bounded(Object.freeze({
      protocol: "historia.history.status/1",
      provider: HISTORIA_NATIVE_PROVIDER_PROTOCOL,
      vault: vault.repository,
      index_path: databasePath,
      verification,
      indexed: index,
      counts: result.counts,
      heads: result.heads,
      sync: await companion.status(),
    }), "Historia history status");
  }

  async function historyList(payload) {
    closedKeys(payload, new Set(["limit", "source_ref"]), "Historia history/list payload");
    const limit = integer(payload.limit, "Historia history list limit", { minimum: 1, maximum: 500, fallback: 100 });
    const sourceRef = optionalText(payload.source_ref, "Historia history source_ref", 512);
    const { index, result } = await indexed((db) => deps.listChatConversations(db, { limit, sourceRef }));
    return bounded(Object.freeze({
      protocol: "historia.history.list/1",
      indexed: index,
      conversations: Object.freeze(result),
    }), "Historia history list");
  }

  async function historySearch(payload) {
    closedKeys(payload, new Set([
      "query", "limit", "source_ref", "role", "since", "until", "historical",
      "expand_topics", "topic_limit", "topic_seed_limit", "topic_min_support",
    ]), "Historia history/search payload");
    const query = text(payload.query, "Historia history search query", MAX_QUERY_CHARS);
    const options = {
      limit: integer(payload.limit, "Historia history search limit", { minimum: 1, maximum: MAX_SEARCH_RESULTS, fallback: 20 }),
      sourceRef: payload.source_ref ?? null,
      role: payload.role ?? null,
      since: payload.since ?? null,
      until: payload.until ?? null,
      historical: boolean(payload.historical),
      expandTopics: boolean(payload.expand_topics),
      topicLimit: integer(payload.topic_limit, "Historia topic limit", { minimum: 1, maximum: 50, fallback: 12 }),
      topicSeedLimit: integer(payload.topic_seed_limit, "Historia topic seed limit", { minimum: 1, maximum: 20, fallback: 6 }),
      topicMinSupport: integer(payload.topic_min_support, "Historia topic minimum support", { minimum: 1, maximum: 100, fallback: 1 }),
    };
    const { index, result } = await indexed((db) => deps.searchChatIndex(db, query, options));
    return bounded(Object.freeze({
      protocol: "historia.history.search/1",
      query,
      indexed: index,
      results: Object.freeze(result.map(publicSearchHit)),
    }), "Historia history search");
  }

  async function historyConversation(payload) {
    closedKeys(payload, new Set([
      "conversation_hid", "source_ref", "commit_oid", "max_messages", "max_content_bytes",
    ]), "Historia history/conversation payload");
    const conversationHid = text(payload.conversation_hid, "Historia conversation_hid", 512);
    const maxMessages = integer(payload.max_messages, "Historia conversation message limit", {
      minimum: 1, maximum: MAX_CONVERSATION_MESSAGES, fallback: 100,
    });
    const maxContentBytes = integer(payload.max_content_bytes, "Historia conversation content limit", {
      minimum: 4096, maximum: MAX_CONVERSATION_CONTENT_BYTES, fallback: 256 * 1024,
    });
    const { index, result } = await indexed((db) => deps.loadConversationSnapshot(db, conversationHid, {
      sourceRef: payload.source_ref ?? null,
      commitOid: payload.commit_oid ?? null,
    }));
    return bounded(Object.freeze({
      protocol: "historia.history.conversation-result/1",
      indexed: index,
      conversation: publicConversation(result, { maxMessages, maxContentBytes }),
    }), "Historia conversation result");
  }

  async function historyImport(payload) {
    closedKeys(payload, new Set(["input_path", "source_key", "include_raw_files"]), "Historia history/import-export payload");
    const inputPath = importPath(payload.input_path);
    const sourceKey = optionalText(payload.source_key, "OpenAI export source_key", 240);
    const includeRawFiles = boolean(payload.include_raw_files, true);
    const archived = await deps.archiveOpenAIExport({
      inputPath,
      vaultPath,
      sourceKey: sourceKey ?? undefined,
      includeRawFiles,
      importedAt: now().toISOString(),
    });
    const index = await deps.indexHistoriaChats({ vaultPath, databasePath });
    return bounded(Object.freeze({
      protocol: "historia.history.import-export/1",
      ok: archived.ok,
      idempotent: archived.idempotent,
      source_ref: archived.ref,
      commit_oid: archived.commitOid,
      previous_commit_oid: archived.previousCommitOid ?? null,
      receipt_path: archived.receiptPath,
      archive_sha256: archived.receipt?.archive?.sha256 ?? null,
      stats: archived.receipt?.stats ?? null,
      warnings: archived.receipt?.warnings ?? [],
      indexed: index,
    }), "Historia import result");
  }

  async function contextBuild(payload) {
    closedKeys(payload, new Set([
      "query", "budget", "max_conversations", "radius", "include_branches", "source_ref",
      "role", "since", "until", "historical", "expand_topics", "topic_limit",
      "topic_seed_limit", "topic_min_support", "format",
    ]), "Historia context/build payload");
    const query = text(payload.query, "Historia context query", MAX_QUERY_CHARS);
    const format = payload.format === undefined ? "markdown" : text(payload.format, "Historia context format", 16);
    if (!new Set(["markdown", "bundle"]).has(format)) throw new Error("Historia context format must be markdown or bundle");
    const options = {
      budget: integer(payload.budget, "Historia context budget", { minimum: 128, maximum: MAX_CONTEXT_BUDGET, fallback: 12_000 }),
      maxConversations: integer(payload.max_conversations, "Historia context conversation limit", { minimum: 1, maximum: 12, fallback: 8 }),
      radius: integer(payload.radius, "Historia context radius", { minimum: 0, maximum: 6, fallback: 2 }),
      includeBranches: boolean(payload.include_branches),
      sourceRef: payload.source_ref ?? null,
      role: payload.role ?? null,
      since: payload.since ?? null,
      until: payload.until ?? null,
      historical: boolean(payload.historical),
      expandTopics: boolean(payload.expand_topics),
      topicLimit: integer(payload.topic_limit, "Historia context topic limit", { minimum: 1, maximum: 50, fallback: 12 }),
      topicSeedLimit: integer(payload.topic_seed_limit, "Historia context topic seed limit", { minimum: 1, maximum: 20, fallback: 6 }),
      topicMinSupport: integer(payload.topic_min_support, "Historia context topic minimum support", { minimum: 1, maximum: 100, fallback: 1 }),
      generatedAt: now().toISOString(),
    };
    const { index, result: bundle } = await indexed((db) => deps.buildChatContext(db, query, options));
    const result = format === "bundle"
      ? { protocol: "historia.context.result/1", format, indexed: index, bundle }
      : {
          protocol: "historia.context.result/1",
          format,
          indexed: index,
          markdown: deps.formatChatContextMarkdown(bundle),
          summary: {
            query: bundle.query,
            matches: bundle.matches,
            budget: bundle.budget,
          },
          citations: bundle.citations,
        };
    return bounded(Object.freeze(result), "Historia context result");
  }

  async function handle(operationValue, payloadValue = {}) {
    const operation = text(operationValue, "Historia native operation", 80);
    if (!OPERATION_SET.has(operation)) throw new Error(`Unsupported Historia native provider operation: ${operation}`);
    const payload = plainObject(payloadValue, `${operation} payload`);
    if (operation === "history/status") return historyStatus();
    if (operation === "history/list") return historyList(payload);
    if (operation === "history/search") return historySearch(payload);
    if (operation === "history/conversation") return historyConversation(payload);
    if (operation === "history/import-export") return historyImport(payload);
    if (operation === "history/sync-status") return bounded(await companion.status(), "Historia sync status");
    if (operation === "history/sync-pull") return bounded(await companion.pull(), "Historia sync pull");
    if (operation === "history/sync-push") {
      closedKeys(payload, new Set(["state", "expected_head", "source"]), "Historia history/sync-push payload");
      return bounded(await companion.push(payload.state, {
        expectedHead: payload.expected_head,
        source: payload.source ?? "historia-chatgpt-extension",
      }), "Historia sync push");
    }
    if (operation === "context/build") return contextBuild(payload);
    throw new Error(`Unsupported Historia native provider operation: ${operation}`);
  }

  return Object.freeze({
    protocol: HISTORIA_NATIVE_PROVIDER_PROTOCOL,
    operations: HISTORIA_NATIVE_PROVIDER_OPERATIONS,
    handle,
  });
}
