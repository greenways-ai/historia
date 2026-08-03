import { canonicalJson } from "../chat/identity.js";
import {
  assertHistoriaSourceRef,
  conversationArchivePaths,
  historiaSourcePath,
  historiaSourceRef,
  messageArchivePaths
} from "../chat/archive-layout.js";
import { defaultHistoriaVaultPath } from "../chat/paths.js";
import { GitVault } from "../vault/git-writer.js";
import { normalizeBrowserObservation } from "./browser-observation.js";

export const BROWSER_COLLECTOR_VERSION = "0.1.0";

function receiptPathFor(captureSha256) {
  return `imports/browser/${captureSha256}/${BROWSER_COLLECTOR_VERSION}.json`;
}

export async function archiveBrowserObservation({
  observation,
  vaultPath = defaultHistoriaVaultPath(),
  ref = null,
  observedAt = null,
  authorName = "Historia Collect",
  authorEmail = "collect@historia.local"
} = {}) {
  const normalized = normalizeBrowserObservation(observation);
  const importedAt = observedAt ?? normalized.observation.observed_at ?? new Date().toISOString();
  const vault = await GitVault.init(vaultPath);
  const sourceKey = normalized.observation.source_key;
  const sourceRef = assertHistoriaSourceRef(ref ?? historiaSourceRef("openai-browser", sourceKey));
  const receiptPath = receiptPathFor(normalized.capture_sha256);
  const previousCommitOid = await vault.resolveRef(sourceRef);
  if (previousCommitOid && await vault.fileExists(sourceRef, receiptPath)) {
    const receipt = JSON.parse(await vault.readText(sourceRef, receiptPath));
    return {
      ok: true,
      idempotent: true,
      vault: vault.repository,
      ref: sourceRef,
      commitOid: await vault.commitForPath(sourceRef, receiptPath) ?? previousCommitOid,
      headCommitOid: previousCommitOid,
      receiptPath,
      receipt
    };
  }

  const files = new Map();
  const sourcePath = historiaSourcePath("openai-browser", sourceKey);
  let previousSource = null;
  if (previousCommitOid && await vault.fileExists(sourceRef, sourcePath)) {
    try { previousSource = JSON.parse(await vault.readText(sourceRef, sourcePath)); }
    catch { previousSource = null; }
  }
  files.set(sourcePath, canonicalJson({
    $schema: "historia.chat.source/v1",
    provider: "openai",
    key: sourceKey,
    completeness: "browser-observed",
    metadata: {
      collector: normalized.observation.collector,
      page_origin: normalized.observation.conversation.url ? new URL(normalized.observation.conversation.url).origin : null
    },
    first_observed_at: previousSource?.first_observed_at ?? importedAt,
    last_observed_at: importedAt,
    importer: { name: "historia-browser-collect", version: BROWSER_COLLECTOR_VERSION }
  }));

  const rawObservationText = canonicalJson(normalized.observation);
  const rawConversationOid = await vault.writeBlob(rawObservationText);
  const conversationPaths = conversationArchivePaths(normalized.conversation.hid, rawConversationOid);
  const rawCapturePath = `raw/captures/${normalized.capture_sha256}/observation.json`;
  files.set(rawCapturePath, { oid: rawConversationOid });
  files.set(conversationPaths.raw, { oid: rawConversationOid });

  const nodes = {};
  const normalizedMessageOids = new Set();
  const rawMessageOids = new Set();
  for (const message of normalized.conversation.messages) {
    const rawMessageText = canonicalJson(message.raw);
    const rawOid = await vault.writeBlob(rawMessageText);
    rawMessageOids.add(rawOid);
    const normalizedMessage = {
      ...message.normalized,
      raw_oid: rawOid,
      normalizer: { name: "historia-browser-collect", version: BROWSER_COLLECTOR_VERSION }
    };
    const normalizedOid = await vault.writeBlob(canonicalJson(normalizedMessage));
    normalizedMessageOids.add(normalizedOid);
    const paths = messageArchivePaths(normalizedOid, rawOid);
    files.set(paths.raw, { oid: rawOid });
    files.set(paths.normalized, { oid: normalizedOid });
    nodes[message.hid] = {
      node_id: message.nodeId,
      revision_oid: normalizedOid,
      raw_oid: rawOid,
      path: paths.normalized
    };
  }

  const manifest = {
    $schema: "historia.chat.conversation/v1",
    hid: normalized.conversation.hid,
    source: normalized.conversation.source,
    title: normalized.conversation.title,
    created_at: normalized.conversation.created_at,
    updated_at: normalized.conversation.updated_at,
    observed_at: importedAt,
    nodes,
    edges: normalized.conversation.edges,
    active_paths: normalized.conversation.active_paths,
    provider_state: normalized.conversation.provider_state,
    raw_oid: rawConversationOid,
    raw_path: rawCapturePath,
    importer: { name: "historia-browser-collect", version: BROWSER_COLLECTOR_VERSION }
  };
  files.set(conversationPaths.manifest, canonicalJson(manifest));

  const receipt = {
    $schema: "historia.chat.import-receipt/v1",
    provider: "openai",
    source_key: sourceKey,
    source_ref: sourceRef,
    source_completeness: "browser-observed",
    archive: {
      sha256: normalized.capture_sha256,
      container_sha256: null,
      byte_count: Buffer.byteLength(rawObservationText),
      file_count: 1,
      manifest_path: rawCapturePath
    },
    importer: { name: "historia-browser-collect", version: BROWSER_COLLECTOR_VERSION },
    observed_at: importedAt,
    previous_commit_oid: previousCommitOid,
    include_raw_files: true,
    stats: {
      conversations: 1,
      messages: normalized.conversation.messages.length,
      branch_points: (() => {
        const children = new Map();
        for (const edge of normalized.conversation.edges) children.set(edge.from, (children.get(edge.from) ?? 0) + 1);
        return [...children.values()].filter((count) => count > 1).length;
      })(),
      files: 1,
      bytes: Buffer.byteLength(rawObservationText),
      normalized_message_blobs: normalizedMessageOids.size,
      raw_message_blobs: rawMessageOids.size,
      conversation_manifests: 1
    },
    warnings: []
  };
  files.set(receiptPath, canonicalJson(receipt));

  const commit = await vault.commitFiles({
    ref: sourceRef,
    expectedOldOid: previousCommitOid,
    files,
    message: `historia(chat): capture browser conversation ${normalized.capture_sha256.slice(0, 12)}`,
    authorName,
    authorEmail,
    timestamp: importedAt
  });
  return {
    ok: true,
    idempotent: false,
    vault: vault.repository,
    ref: sourceRef,
    commitOid: commit.commitOid,
    previousCommitOid,
    receiptPath,
    receipt,
    captureSha256: normalized.capture_sha256,
    paths: {
      source: sourcePath,
      conversation: conversationPaths.manifest,
      rawCapture: rawCapturePath
    }
  };
}
