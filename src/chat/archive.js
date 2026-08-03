import { canonicalJson } from "./identity.js";
import { assertHistoriaSourceRef, conversationArchivePaths, historiaSourcePath, historiaSourceRef, messageArchivePaths } from "./archive-layout.js";
import { defaultHistoriaVaultPath } from "./paths.js";
import { OPENAI_IMPORTER_VERSION, receiptKeyFor, withOpenAIExport } from "./openai-export.js";
import { GitVault } from "../vault/git-writer.js";

export { defaultHistoriaVaultPath } from "./paths.js";

function encodeArchivePath(relativePath) {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function initHistoriaVault(vaultPath = defaultHistoriaVaultPath(), options = {}) {
  const vault = await GitVault.init(vaultPath, options);
  return { vault: vault.repository, objectFormat: await vault.objectFormat() };
}

export async function archiveOpenAIExport({
  inputPath,
  vaultPath = defaultHistoriaVaultPath(),
  sourceKey,
  ref,
  importedAt = new Date().toISOString(),
  includeRawFiles = true,
  authorName = "Historia Collect",
  authorEmail = "collect@historia.local"
}) {
  if (!inputPath) throw new Error("inputPath is required");
  const vault = await GitVault.init(vaultPath);

  return withOpenAIExport(inputPath, { sourceKey }, async (exported) => {
    const sourceRef = assertHistoriaSourceRef(ref ?? historiaSourceRef("openai", exported.source.key));
    const receiptPath = receiptKeyFor(exported.archive.sha256, { includeRawFiles });
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
    const normalizedMessageOids = new Set();
    const rawMessageOids = new Set();
    const conversationManifestPaths = [];

    const sourcePath = historiaSourcePath("openai", exported.source.key);
    let previousSource = null;
    if (previousCommitOid && await vault.fileExists(sourceRef, sourcePath)) {
      try { previousSource = JSON.parse(await vault.readText(sourceRef, sourcePath)); }
      catch { previousSource = null; }
    }
    const sourceRecord = {
      $schema: "historia.chat.source/v1",
      provider: "openai",
      key: exported.source.key,
      completeness: exported.source.completeness,
      metadata: exported.source.metadata,
      first_observed_at: previousSource?.first_observed_at ?? importedAt,
      last_observed_at: importedAt,
      importer: { name: "historia-openai-export", version: OPENAI_IMPORTER_VERSION }
    };
    files.set(sourcePath, canonicalJson(sourceRecord));

    for (const conversation of exported.conversations) {
      const rawConversationText = canonicalJson(conversation.raw);
      const rawConversationOid = await vault.writeBlob(rawConversationText);
      const paths = conversationArchivePaths(conversation.hid, rawConversationOid);
      files.set(paths.raw, { oid: rawConversationOid });

      const nodes = {};
      for (const message of conversation.messages) {
        const rawMessageText = canonicalJson(message.raw);
        const rawOid = await vault.writeBlob(rawMessageText);
        rawMessageOids.add(rawOid);

        // Observation time belongs to the manifest and receipt. Keeping it out of
        // the normalized message makes unchanged message revisions retain the same
        // Git OID across later account exports.
        const normalizedMessage = {
          ...message.normalized,
          raw_oid: rawOid,
          normalizer: { name: "historia-openai-export", version: OPENAI_IMPORTER_VERSION }
        };
        const normalizedText = canonicalJson(normalizedMessage);
        const normalizedOid = await vault.writeBlob(normalizedText);
        normalizedMessageOids.add(normalizedOid);
        const messagePath = messageArchivePaths(normalizedOid, rawOid);
        files.set(messagePath.raw, { oid: rawOid });
        files.set(messagePath.normalized, { oid: normalizedOid });
        nodes[message.hid] = {
          node_id: message.nodeId,
          revision_oid: normalizedOid,
          raw_oid: rawOid,
          path: messagePath.normalized
        };
      }

      const manifest = {
        $schema: "historia.chat.conversation/v1",
        hid: conversation.hid,
        source: conversation.source,
        title: conversation.title,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        observed_at: importedAt,
        nodes,
        edges: conversation.edges,
        active_paths: conversation.active_paths,
        provider_state: conversation.provider_state,
        raw_oid: rawConversationOid,
        raw_path: paths.raw,
        importer: { name: "historia-openai-export", version: OPENAI_IMPORTER_VERSION }
      };
      files.set(paths.manifest, canonicalJson(manifest));
      conversationManifestPaths.push(paths.manifest);
    }

    const rawExportPrefix = `raw/exports/${exported.archive.sha256}`;
    const rawManifestPath = `${rawExportPrefix}/manifest.json`;
    files.set(rawManifestPath, canonicalJson({
      $schema: "historia.chat.raw-export-manifest/v1",
      provider: "openai",
      archive: exported.archive
    }));
    if (includeRawFiles) {
      for (const file of exported.prepared.files) {
        files.set(`${rawExportPrefix}/files/${encodeArchivePath(file.relativePath)}`, { filePath: file.absolutePath });
      }
    }

    const receipt = {
      $schema: "historia.chat.import-receipt/v1",
      provider: "openai",
      source_key: exported.source.key,
      source_ref: sourceRef,
      source_completeness: exported.source.completeness,
      archive: {
        sha256: exported.archive.sha256,
        container_sha256: exported.archive.container_sha256,
        byte_count: exported.archive.byte_count,
        file_count: exported.archive.files.length,
        manifest_path: rawManifestPath
      },
      importer: { name: "historia-openai-export", version: OPENAI_IMPORTER_VERSION },
      observed_at: importedAt,
      previous_commit_oid: previousCommitOid,
      include_raw_files: includeRawFiles,
      stats: {
        ...exported.stats,
        normalized_message_blobs: normalizedMessageOids.size,
        raw_message_blobs: rawMessageOids.size,
        conversation_manifests: conversationManifestPaths.length
      },
      warnings: exported.warnings
    };
    files.set(receiptPath, canonicalJson(receipt));

    const commit = await vault.commitFiles({
      ref: sourceRef,
      expectedOldOid: previousCommitOid,
      files,
      message: `historia(chat): import OpenAI export ${exported.archive.sha256.slice(0, 12)}`,
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
      paths: {
        source: sourcePath,
        conversations: conversationManifestPaths
      }
    };
  });
}

export async function verifyHistoriaVault(vaultPath = defaultHistoriaVaultPath()) {
  const vault = await GitVault.init(vaultPath);
  return { vault: vault.repository, ...await vault.verify() };
}
