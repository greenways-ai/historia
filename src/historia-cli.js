#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { archiveOpenAIExport, defaultHistoriaVaultPath, initHistoriaVault, verifyHistoriaVault } from "./chat/archive.js";
import { archiveBrowserObservation } from "./collect/archive.js";
import { writeNativeHostManifest } from "./collect/native-manifest.js";
import { startCollectServer } from "./collect/server.js";
import { buildChatContext, formatChatContextMarkdown } from "./chat/context.js";
import { defaultHistoriaIndexPath, openChatIndex } from "./chat/index-storage.js";
import { indexHistoriaChats } from "./chat/indexer.js";
import { inspectOpenAIExport } from "./chat/openai-export.js";
import { listChatConversations, loadConversationSnapshot, searchChatIndex } from "./chat/search.js";
import historiaChatSkill from "../skills/historia-chat-agent/SKILL.md" with { type: "text" };

const VERSION = "0.1.0";

function usage() {
  console.log(`Historia ${VERSION}

Git-native private history for conversations and agent context.

Usage:
  historia vault init [--vault <path>]
  historia vault verify [--vault <path>]

  historia chat inspect-openai <export.zip|directory|conversations.json> [--source <key>]
  historia chat import-openai <export.zip|directory|conversations.json> [--vault <path>] [--database <path>] [--source <key>] [--ref <ref>] [--no-raw] [--no-index]
  historia collect import-openai <export.zip|directory|conversations.json> [options]
  historia collect capture-json <observation.json> [--vault <path>] [--database <path>] [--ref <ref>] [--no-index]
  historia collect native-manifest --browser chrome|firefox --extension-id <id> --host-path <path> --output <path>
  historia collect status [--vault <path>] [--database <path>]
  historia collect serve [--host 127.0.0.1] [--port 4319] [--vault <path>] [--database <path>]

  historia chat index [--vault <path>] [--database <path>] [--rebuild]
  historia chat search <query...> [--limit <n>] [--source-ref <ref>] [--role <role>] [--since <time>] [--until <time>] [--historical]
  historia chat list [--limit <n>] [--source-ref <ref>]
  historia chat show <conversation-hid> [--source-ref <ref>] [--commit <oid>]
  historia context build <query...> [--budget <tokens>] [--max-conversations <n>] [--radius <n>] [--include-branches] [--historical] [--format json|markdown] [--output <path>]
  historia agent install codex|kimi [--scope user|project]

  historia --version

Environment:
  HISTORIA_VAULT     Override the default bare Git vault path.
  HISTORIA_INDEX     Override the default rebuildable SQLite chat index.
`);
}

function summarizeInspection(result) {
  return {
    provider: result.provider,
    source: {
      key: result.source.key,
      completeness: result.source.completeness,
      metadata_file: result.source.metadata_file
    },
    archive: {
      sha256: result.archive.sha256,
      container_sha256: result.archive.container_sha256,
      byte_count: result.archive.byte_count,
      file_count: result.archive.files.length
    },
    stats: result.stats,
    warnings: result.warnings,
    conversations: result.conversations.map((conversation) => ({
      hid: conversation.hid,
      title: conversation.title,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      messages: conversation.messages.length,
      edges: conversation.edges.length,
      active_path_messages: conversation.active_paths[0]?.length ?? 0
    }))
  };
}

function summarizeImport(result, index = null) {
  return {
    ok: result.ok,
    idempotent: result.idempotent,
    vault: result.vault,
    ref: result.ref,
    commit_oid: result.commitOid,
    head_commit_oid: result.headCommitOid ?? result.commitOid,
    previous_commit_oid: result.previousCommitOid ?? null,
    receipt_path: result.receiptPath,
    stats: result.receipt?.stats ?? null,
    warnings: result.receipt?.warnings ?? [],
    index
  };
}

function numberOption(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`numeric option is invalid: ${value}`);
  return number;
}

async function installAgentSkill(agent, scope = "user") {
  const normalizedAgent = String(agent ?? "").toLowerCase();
  if (!new Set(["codex", "kimi"]).has(normalizedAgent)) throw new Error("agent must be codex or kimi");
  if (!new Set(["user", "project"]).has(scope)) throw new Error("--scope must be user or project");
  const base = normalizedAgent === "codex"
    ? (scope === "project" ? resolve(".codex/skills") : join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills"))
    : (scope === "project" ? resolve(".kimi-code/skills") : join(process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code"), "skills"));
  const destination = join(base, "historia-chat-agent");
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "SKILL.md"), historiaChatSkill, { mode: 0o600 });
  return { ok: true, agent: normalizedAgent, scope, destination };
}

async function emit(value, { format = "json", output = null } = {}) {
  let text;
  if (format === "json") text = `${JSON.stringify(value, null, 2)}\n`;
  else if (format === "markdown") text = typeof value === "string" ? value : formatChatContextMarkdown(value);
  else throw new Error(`unsupported output format: ${format}`);

  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text);
    console.log(JSON.stringify({ ok: true, output, format }));
  } else {
    process.stdout.write(text);
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
    vault: { type: "string" },
    database: { type: "string" },
    source: { type: "string" },
    "source-ref": { type: "string" },
    ref: { type: "string" },
    commit: { type: "string" },
    role: { type: "string", multiple: true },
    since: { type: "string" },
    until: { type: "string" },
    limit: { type: "string" },
    budget: { type: "string" },
    radius: { type: "string" },
    "max-conversations": { type: "string" },
    format: { type: "string" },
    output: { type: "string" },
    browser: { type: "string" },
    "extension-id": { type: "string" },
    "host-path": { type: "string" },
    "host-name": { type: "string" },
    host: { type: "string" },
    port: { type: "string" },
    scope: { type: "string" },
    rebuild: { type: "boolean" },
    historical: { type: "boolean" },
    "include-branches": { type: "boolean" },
    "no-raw": { type: "boolean" },
    "no-index": { type: "boolean" }
  }
});

async function main() {
  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help || positionals.length === 0) {
    usage();
    return;
  }

  const vaultPath = values.vault ?? defaultHistoriaVaultPath();
  const databasePath = values.database ?? defaultHistoriaIndexPath(vaultPath);
  const [domain, command, inputPath] = positionals;
  if (domain === "vault" && command === "init") {
    await emit(await initHistoriaVault(vaultPath));
    return;
  }
  if (domain === "vault" && command === "verify") {
    const result = await verifyHistoriaVault(vaultPath);
    await emit(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (domain === "chat" && command === "inspect-openai") {
    if (!inputPath) throw new Error("an OpenAI export path is required");
    await emit(summarizeInspection(await inspectOpenAIExport(inputPath, { sourceKey: values.source })));
    return;
  }
  if (["chat", "collect"].includes(domain) && command === "import-openai") {
    if (!inputPath) throw new Error("an OpenAI export path is required");
    const result = await archiveOpenAIExport({
      inputPath,
      vaultPath,
      sourceKey: values.source,
      ref: values.ref,
      includeRawFiles: !values["no-raw"]
    });
    const index = values["no-index"] ? null : await indexHistoriaChats({ vaultPath, databasePath });
    await emit(summarizeImport(result, index));
    return;
  }
  if (domain === "collect" && command === "capture-json") {
    if (!inputPath) throw new Error("a browser observation JSON path is required");
    const bytes = await readFile(inputPath);
    if (bytes.length > 32 * 1024 * 1024) throw new Error("browser observation JSON exceeds 32 MiB");
    let observation;
    try { observation = JSON.parse(bytes.toString("utf8")); }
    catch (error) { throw new Error(`invalid browser observation JSON: ${error.message}`); }
    const result = await archiveBrowserObservation({ observation, vaultPath, ref: values.ref });
    const index = values["no-index"] ? null : await indexHistoriaChats({ vaultPath, databasePath });
    await emit(summarizeImport(result, index));
    return;
  }
  if (domain === "collect" && command === "native-manifest") {
    if (!values.output) throw new Error("--output is required for a native host manifest");
    if (!values["extension-id"]) throw new Error("--extension-id is required for a native host manifest");
    if (!values["host-path"]) throw new Error("--host-path is required for a native host manifest");
    await emit(await writeNativeHostManifest(values.output, {
      browser: values.browser ?? "chrome",
      extensionId: values["extension-id"],
      hostPath: values["host-path"],
      name: values["host-name"]
    }));
    return;
  }
  if (domain === "collect" && command === "status") {
    const verification = await verifyHistoriaVault(vaultPath);
    const index = await indexHistoriaChats({ vaultPath, databasePath });
    await emit({ verification, index });
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  if (domain === "collect" && command === "serve") {
    const hostname = values.host ?? "127.0.0.1";
    const port = numberOption(values.port, 4319);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer between 1 and 65535");
    const started = startCollectServer({ hostname, port, vaultPath, databasePath });
    console.log(`Historia Collect ${VERSION}`);
    console.log(`Local application: ${started.url}`);
    console.log(`Vault: ${vaultPath}`);
    console.log(`Index: ${databasePath}`);
    console.log("Press Ctrl+C to stop.");
    return;
  }
  if (domain === "agent" && command === "install") {
    if (!inputPath) throw new Error("an agent name is required: codex or kimi");
    await emit(await installAgentSkill(inputPath, values.scope ?? "user"));
    return;
  }
  if (domain === "chat" && command === "index") {
    await emit(await indexHistoriaChats({ vaultPath, databasePath, rebuild: values.rebuild }));
    return;
  }

  const updateIndex = async () => values["no-index"] ? null : indexHistoriaChats({ vaultPath, databasePath });
  if (domain === "chat" && command === "search") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw new Error("a chat search query is required");
    const index = await updateIndex();
    const db = await openChatIndex(databasePath);
    try {
      await emit({
        query,
        historical: Boolean(values.historical),
        index,
        results: searchChatIndex(db, query, {
          limit: numberOption(values.limit, 20),
          sourceRef: values["source-ref"],
          role: values.role,
          since: values.since,
          until: values.until,
          historical: values.historical
        })
      });
    } finally {
      db.close();
    }
    return;
  }
  if (domain === "chat" && command === "list") {
    const index = await updateIndex();
    const db = await openChatIndex(databasePath);
    try {
      await emit({
        index,
        conversations: listChatConversations(db, {
          limit: numberOption(values.limit, 100),
          sourceRef: values["source-ref"]
        })
      });
    } finally {
      db.close();
    }
    return;
  }
  if (domain === "chat" && command === "show") {
    if (!inputPath) throw new Error("a conversation HID is required");
    await updateIndex();
    const db = await openChatIndex(databasePath);
    try {
      const conversation = loadConversationSnapshot(db, inputPath, {
        sourceRef: values["source-ref"],
        commitOid: values.commit
      });
      if (!conversation) throw new Error(`conversation not found: ${inputPath}`);
      await emit(conversation);
    } finally {
      db.close();
    }
    return;
  }
  if (domain === "context" && command === "build") {
    const query = positionals.slice(2).join(" ").trim();
    if (!query) throw new Error("a context query is required");
    await updateIndex();
    const db = await openChatIndex(databasePath);
    try {
      const bundle = buildChatContext(db, query, {
        budget: numberOption(values.budget, 12_000),
        maxConversations: numberOption(values["max-conversations"], 8),
        radius: numberOption(values.radius, 2),
        includeBranches: values["include-branches"],
        sourceRef: values["source-ref"],
        role: values.role,
        since: values.since,
        until: values.until,
        historical: values.historical
      });
      await emit(bundle, { format: values.format ?? "markdown", output: values.output });
    } finally {
      db.close();
    }
    return;
  }

  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`historia: ${error.message}`);
  process.exitCode = 1;
});
