import { sourceKeyFor } from "./identity.js";
import { DEFAULT_MAX_JSON_BYTES } from "./openai-export/limits.js";
import { prepareOpenAIInput } from "./openai-export/archive-input.js";
import { conversationFiles, payloadConversations, readJson, sourceMetadataFile } from "./openai-export/records.js";
import {
  compareOpenAIUpdateTime,
  normalizeOpenAIConversation,
  openAIConversationProviderId
} from "./openai-export/conversation.js";

export { normalizeOpenAIContent } from "./openai-export/content.js";
export { normalizeOpenAIConversation } from "./openai-export/conversation.js";

export const OPENAI_IMPORTER_VERSION = "0.1.0";

async function parsePreparedExport(prepared, { sourceKey, maxJsonBytes = DEFAULT_MAX_JSON_BYTES } = {}) {
  const files = conversationFiles(prepared);
  if (!files.length) throw new Error("no conversations.json or numbered conversation JSON files were found");
  const rawConversations = [];
  for (const file of files) rawConversations.push(...payloadConversations(await readJson(file, maxJsonBytes)));

  const sourceFile = sourceMetadataFile(prepared);
  const sourceMetadata = sourceFile ? await readJson(sourceFile, Math.min(maxJsonBytes, 16 * 1024 * 1024)) : null;
  const sourceIdentity = sourceKey
    ?? sourceMetadata?.id
    ?? sourceMetadata?.user_id
    ?? sourceMetadata?.email
    ?? "default";
  const resolvedSourceKey = sourceKey ? String(sourceKey) : sourceKeyFor("openai", sourceIdentity);

  const deduplicated = new Map();
  for (const conversation of rawConversations) {
    const id = openAIConversationProviderId(conversation);
    const previous = deduplicated.get(id);
    if (!previous || compareOpenAIUpdateTime(previous, conversation) <= 0) deduplicated.set(id, conversation);
  }
  const conversations = [...deduplicated.values()]
    .map((conversation) => normalizeOpenAIConversation(conversation, { sourceKey: resolvedSourceKey }))
    .sort((left, right) => (left.created_at ?? "").localeCompare(right.created_at ?? "") || left.hid.localeCompare(right.hid));

  const messageCount = conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0);
  const branchCount = conversations.reduce((sum, conversation) => {
    const incoming = new Map();
    for (const edge of conversation.edges) incoming.set(edge.from, (incoming.get(edge.from) ?? 0) + 1);
    return sum + [...incoming.values()].filter((count) => count > 1).length;
  }, 0);

  return {
    provider: "openai",
    source: {
      key: resolvedSourceKey,
      completeness: "full-account-export",
      metadata: sourceMetadata,
      metadata_file: sourceFile?.relativePath ?? null
    },
    archive: {
      sha256: prepared.fingerprint.sha256,
      container_sha256: prepared.containerSha256,
      byte_count: prepared.totalBytes,
      files: prepared.fingerprint.files
    },
    conversations,
    stats: {
      conversations: conversations.length,
      messages: messageCount,
      branch_points: branchCount,
      files: prepared.files.length,
      bytes: prepared.totalBytes
    },
    warnings: rawConversations.length === deduplicated.size
      ? []
      : [`deduplicated ${rawConversations.length - deduplicated.size} repeated conversation records`]
  };
}

export async function withOpenAIExport(inputPath, options = {}, callback) {
  const prepared = await prepareOpenAIInput(inputPath, options);
  try {
    const parsed = await parsePreparedExport(prepared, options);
    return await callback({ ...parsed, prepared });
  } finally {
    await prepared.cleanup();
  }
}

export async function inspectOpenAIExport(inputPath, options = {}) {
  return withOpenAIExport(inputPath, options, async ({ prepared: _prepared, ...parsed }) => parsed);
}

export function receiptKeyFor(archiveSha256, { includeRawFiles = true } = {}) {
  const profile = includeRawFiles ? "raw" : "normalized";
  return `imports/openai/${archiveSha256}/${OPENAI_IMPORTER_VERSION}/${profile}.json`;
}
