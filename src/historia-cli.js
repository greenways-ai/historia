#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { archiveOpenAIExport, defaultHistoriaVaultPath, initHistoriaVault, verifyHistoriaVault } from "./chat/archive.js";
import { inspectOpenAIExport } from "./chat/openai-export.js";

const VERSION = "0.1.0";

function usage() {
  console.log(`Historia ${VERSION}

Git-native private history for conversations and agent context.

Usage:
  historia vault init [--vault <path>]
  historia vault verify [--vault <path>]
  historia chat inspect-openai <export.zip|directory|conversations.json> [--source <key>]
  historia chat import-openai <export.zip|directory|conversations.json> [--vault <path>] [--source <key>] [--ref <ref>] [--no-raw]
  historia collect import-openai <export.zip|directory|conversations.json> [options]
  historia --version

Environment:
  HISTORIA_VAULT     Override the default bare Git vault path.
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

function summarizeImport(result) {
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
    warnings: result.receipt?.warnings ?? []
  };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
    vault: { type: "string" },
    source: { type: "string" },
    ref: { type: "string" },
    "no-raw": { type: "boolean" }
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
  const [domain, command, inputPath] = positionals;
  if (domain === "vault" && command === "init") {
    console.log(JSON.stringify(await initHistoriaVault(vaultPath), null, 2));
    return;
  }
  if (domain === "vault" && command === "verify") {
    const result = await verifyHistoriaVault(vaultPath);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (domain === "chat" && command === "inspect-openai") {
    if (!inputPath) throw new Error("an OpenAI export path is required");
    console.log(JSON.stringify(summarizeInspection(await inspectOpenAIExport(inputPath, { sourceKey: values.source })), null, 2));
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
    console.log(JSON.stringify(summarizeImport(result), null, 2));
    return;
  }

  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`historia: ${error.message}`);
  process.exitCode = 1;
});
