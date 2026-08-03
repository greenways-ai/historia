import { canonicalJson } from "./identity.js";
import { defaultHistoriaVaultPath } from "./paths.js";
import { chatIndexCounts, clearChatIndex, defaultHistoriaIndexPath, openChatIndex } from "./index-storage.js";
import { estimateTokens, messageSearchText } from "./text.js";
import { changedHistoriaPaths, commitsForHistoriaRef, historiaCommitMetadata, listHistoriaSourceRefs } from "./vault-history.js";
import { GitVault } from "../vault/git-writer.js";
import { readGitJsonObjectsBatched } from "../vault/object-batch.js";

const SOURCE_PATH = /^sources\/[^/]+\/[^/]+\/source\.json$/;
const RECEIPT_PATH = /^imports\/.*\.json$/;
const CONVERSATION_PATH = /^conversations\/[^/]+\/[^/]+\/manifest\.json$/;

function jsonText(value) {
  return canonicalJson(value, { newline: false });
}

function primaryActivePositions(manifest) {
  const active = new Set();
  const positions = new Map();
  for (const [pathIndex, path] of (manifest.active_paths ?? []).entries()) {
    for (const [position, messageHid] of (path ?? []).entries()) {
      active.add(messageHid);
      if (pathIndex === 0 || !positions.has(messageHid)) positions.set(messageHid, position);
    }
  }
  return { active, positions };
}

function sourceIdentity(sourceRecord, receipts, manifests, sourceRef) {
  const receipt = receipts[0]?.json;
  const manifest = manifests[0]?.json;
  return {
    provider: sourceRecord?.provider ?? receipt?.provider ?? manifest?.source?.provider ?? "unknown",
    sourceKey: sourceRecord?.key ?? receipt?.source_key ?? manifest?.source?.source_key ?? sourceRef,
    completeness: sourceRecord?.completeness ?? receipt?.source_completeness ?? "unknown"
  };
}

function relevantPath(path) {
  return SOURCE_PATH.test(path) || RECEIPT_PATH.test(path) || CONVERSATION_PATH.test(path);
}

function createStatements(db) {
  return {
    upsertSource: db.query(`
      INSERT INTO chat_sources(source_ref, provider, source_key, completeness, head_commit_oid)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_ref) DO UPDATE SET
        provider = excluded.provider,
        source_key = excluded.source_key,
        completeness = excluded.completeness,
        head_commit_oid = excluded.head_commit_oid,
        last_indexed_at = CURRENT_TIMESTAMP
    `),
    insertCommit: db.query(`
      INSERT OR IGNORE INTO chat_commits(source_ref, commit_oid, parent_oid, authored_at, committed_at, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    insertImport: db.query(`
      INSERT OR REPLACE INTO chat_imports(source_ref, commit_oid, receipt_path, provider, source_key, archive_sha256, observed_at, previous_commit_oid, receipt_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertConversation: db.query(`
      INSERT INTO chat_conversations(hid, provider, source_key, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(hid) DO UPDATE SET
        provider = excluded.provider,
        source_key = excluded.source_key,
        first_seen_at = COALESCE(chat_conversations.first_seen_at, excluded.first_seen_at),
        last_seen_at = COALESCE(excluded.last_seen_at, chat_conversations.last_seen_at)
    `),
    insertConversationObservation: db.query(`
      INSERT OR REPLACE INTO chat_conversation_observations(
        source_ref, commit_oid, conversation_hid, manifest_path, title, created_at, updated_at,
        observed_at, raw_oid, node_count, edge_count, active_path_json, manifest_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertIdentity: db.query(`
      INSERT INTO chat_message_identities(hid, provider, source_key, conversation_hid, role, author_kind)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(hid) DO UPDATE SET
        role = excluded.role,
        author_kind = excluded.author_kind
    `),
    getRevision: db.query(`
      SELECT revision_oid, message_hid, role, author_json, model, created_at, updated_at,
             content_text, message_json, raw_oid, token_estimate
      FROM chat_message_revisions WHERE revision_oid = ?
    `),
    insertRevision: db.query(`
      INSERT OR IGNORE INTO chat_message_revisions(
        revision_oid, message_hid, role, author_json, model, created_at, updated_at,
        content_text, message_json, raw_oid, token_estimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertMessageObservation: db.query(`
      INSERT OR REPLACE INTO chat_message_observations(
        source_ref, commit_oid, conversation_hid, message_hid, revision_oid, node_id,
        active, active_position, observed_at, manifest_path, message_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertEdge: db.query(`
      INSERT OR REPLACE INTO chat_edges(source_ref, commit_oid, conversation_hid, from_message_hid, to_message_hid, kind)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    getDocument: db.query("SELECT revision_oid, message_hid, conversation_hid, title, role, content FROM chat_message_documents WHERE revision_oid = ?"),
    upsertDocument: db.query(`
      INSERT INTO chat_message_documents(revision_oid, message_hid, conversation_hid, title, role, content)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(revision_oid) DO UPDATE SET
        message_hid = excluded.message_hid,
        conversation_hid = excluded.conversation_hid,
        title = excluded.title,
        role = excluded.role,
        content = excluded.content
    `),
    deleteSearchDocument: db.query("DELETE FROM chat_message_search WHERE revision_oid = ?"),
    insertSearchDocument: db.query(`
      INSERT INTO chat_message_search(revision_oid, message_hid, conversation_hid, title, role, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    writeCheckpoint: db.query(`
      INSERT INTO chat_index_checkpoints(source_ref, last_commit_oid, generation)
      VALUES (?, ?, 1)
      ON CONFLICT(source_ref) DO UPDATE SET
        last_commit_oid = excluded.last_commit_oid,
        generation = chat_index_checkpoints.generation + 1,
        updated_at = CURRENT_TIMESTAMP
    `)
  };
}

function writeSearchDocument(statements, document) {
  const previous = statements.getDocument.get(document.revisionOid);
  const unchanged = previous
    && previous.message_hid === document.messageHid
    && previous.conversation_hid === document.conversationHid
    && previous.title === document.title
    && previous.role === document.role
    && previous.content === document.content;
  if (unchanged) return false;
  statements.upsertDocument.run(
    document.revisionOid,
    document.messageHid,
    document.conversationHid,
    document.title,
    document.role,
    document.content
  );
  statements.deleteSearchDocument.run(document.revisionOid);
  statements.insertSearchDocument.run(
    document.revisionOid,
    document.messageHid,
    document.conversationHid,
    document.title,
    document.role,
    document.content
  );
  return true;
}

async function loadCommitRecords(vault, db, commitOid, parentOid, changedPaths, statements) {
  const paths = changedPaths.filter(relevantPath);
  const pathSpecs = paths.map((path) => `${commitOid}:${path}`);
  const pathObjects = await readGitJsonObjectsBatched(vault.repository, pathSpecs);
  const records = paths.map((path) => ({ path, object: pathObjects.get(`${commitOid}:${path}`) }))
    .filter((entry) => entry.object && !entry.object.missing);
  const sourceRecord = records.find((entry) => SOURCE_PATH.test(entry.path))?.object.json ?? null;
  const receipts = records.filter((entry) => RECEIPT_PATH.test(entry.path)).map((entry) => ({ path: entry.path, json: entry.object.json }));
  const manifests = records.filter((entry) => CONVERSATION_PATH.test(entry.path)).map((entry) => ({ path: entry.path, json: entry.object.json }));

  const revisionOids = [...new Set(manifests.flatMap(({ json }) => Object.values(json.nodes ?? {}).map((node) => node?.revision_oid).filter(Boolean)))];
  const missingRevisionOids = revisionOids.filter((oid) => !statements.getRevision.get(oid));
  const messageObjects = await readGitJsonObjectsBatched(vault.repository, missingRevisionOids);
  for (const oid of missingRevisionOids) {
    const object = messageObjects.get(oid);
    if (!object || object.missing) throw new Error(`message revision ${oid} referenced by ${commitOid} is missing from the vault`);
  }
  return { sourceRecord, receipts, manifests, messageObjects };
}

async function indexCommit({ vault, db, sourceRef, commitOid, metadata, changedPaths, statements }) {
  const parentOid = metadata.parents[0] ?? null;
  const loaded = await loadCommitRecords(vault, db, commitOid, parentOid, changedPaths, statements);
  const identity = sourceIdentity(loaded.sourceRecord, loaded.receipts, loaded.manifests, sourceRef);
  let newRevisions = 0;
  let indexedDocuments = 0;
  let conversationObservations = 0;
  let messageObservations = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    statements.upsertSource.run(sourceRef, identity.provider, identity.sourceKey, identity.completeness, commitOid);
    statements.insertCommit.run(sourceRef, commitOid, parentOid, metadata.authoredAt, metadata.committedAt, metadata.message);

    for (const receipt of loaded.receipts) {
      statements.insertImport.run(
        sourceRef,
        commitOid,
        receipt.path,
        receipt.json.provider ?? identity.provider,
        receipt.json.source_key ?? identity.sourceKey,
        receipt.json.archive?.sha256 ?? "unknown",
        receipt.json.observed_at ?? metadata.committedAt,
        receipt.json.previous_commit_oid ?? parentOid,
        jsonText(receipt.json)
      );
    }

    for (const { path: manifestPath, json: manifest } of loaded.manifests) {
      const provider = manifest.source?.provider ?? identity.provider;
      const sourceKey = manifest.source?.source_key ?? identity.sourceKey;
      const observedAt = manifest.observed_at ?? metadata.committedAt;
      const title = String(manifest.title ?? "Untitled conversation");
      const nodes = manifest.nodes ?? {};
      const edges = Array.isArray(manifest.edges) ? manifest.edges : [];
      const active = primaryActivePositions(manifest);

      statements.upsertConversation.run(manifest.hid, provider, sourceKey, manifest.created_at, manifest.updated_at ?? observedAt);
      statements.insertConversationObservation.run(
        sourceRef,
        commitOid,
        manifest.hid,
        manifestPath,
        title,
        manifest.created_at,
        manifest.updated_at,
        observedAt,
        manifest.raw_oid ?? null,
        Object.keys(nodes).length,
        edges.length,
        jsonText(manifest.active_paths ?? []),
        jsonText(manifest)
      );
      conversationObservations += 1;

      for (const [messageHid, node] of Object.entries(nodes)) {
        const revisionOid = node?.revision_oid;
        if (!revisionOid) continue;
        if (!node?.path) throw new Error(`manifest ${manifest.hid} is missing the archive path for ${messageHid}`);
        let revision = statements.getRevision.get(revisionOid);
        if (!revision) {
          const object = loaded.messageObjects.get(revisionOid);
          if (!object || object.missing) throw new Error(`message revision ${revisionOid} is unavailable while indexing ${manifest.hid}`);
          const message = object.json;
          if (message.hid !== messageHid) {
            throw new Error(`manifest ${manifest.hid} maps ${messageHid} to revision for ${message.hid ?? "unknown"}`);
          }
          const content = messageSearchText(message);
          statements.upsertIdentity.run(
            messageHid,
            message.source?.provider ?? provider,
            message.source?.source_key ?? sourceKey,
            manifest.hid,
            message.role ?? "unknown",
            message.author?.kind ?? message.role ?? "unknown"
          );
          statements.insertRevision.run(
            revisionOid,
            messageHid,
            message.role ?? "unknown",
            jsonText(message.author ?? {}),
            message.model ?? null,
            message.created_at ?? null,
            message.updated_at ?? null,
            content,
            object.text,
            message.raw_oid ?? null,
            estimateTokens(content)
          );
          revision = statements.getRevision.get(revisionOid);
          newRevisions += 1;
        } else {
          statements.upsertIdentity.run(messageHid, provider, sourceKey, manifest.hid, revision.role ?? "unknown", JSON.parse(revision.author_json ?? "{}").kind ?? revision.role ?? "unknown");
        }

        if (writeSearchDocument(statements, {
          revisionOid,
          messageHid,
          conversationHid: manifest.hid,
          title,
          role: revision.role,
          content: revision.content_text
        })) indexedDocuments += 1;

        statements.insertMessageObservation.run(
          sourceRef,
          commitOid,
          manifest.hid,
          messageHid,
          revisionOid,
          node?.node_id ?? null,
          active.active.has(messageHid) ? 1 : 0,
          active.positions.get(messageHid) ?? null,
          observedAt,
          manifestPath,
          node.path
        );
        messageObservations += 1;
      }

      for (const edge of edges) {
        if (!edge?.from || !edge?.to) continue;
        statements.insertEdge.run(sourceRef, commitOid, manifest.hid, edge.from, edge.to, edge.kind ?? "reply");
      }
    }

    statements.writeCheckpoint.run(sourceRef, commitOid);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    commitOid,
    newRevisions,
    indexedDocuments,
    conversationObservations,
    messageObservations,
    imports: loaded.receipts.length
  };
}

function checkpointMap(db) {
  return new Map(db.query("SELECT source_ref, last_commit_oid FROM chat_index_checkpoints").all()
    .map((row) => [row.source_ref, row.last_commit_oid]));
}

export async function indexHistoriaChats({
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath),
  rebuild = false,
  refs = null
} = {}) {
  const vault = await GitVault.init(vaultPath);
  const db = await openChatIndex(databasePath);
  let reset = Boolean(rebuild);
  let sourceRefs = await listHistoriaSourceRefs(vault);
  if (refs?.length) {
    const requested = new Set(refs);
    sourceRefs = sourceRefs.filter((entry) => requested.has(entry.ref));
    const missing = [...requested].filter((ref) => !sourceRefs.some((entry) => entry.ref === ref));
    if (missing.length) {
      db.close();
      throw new Error(`Historia source refs not found: ${missing.join(", ")}`);
    }
  }

  const commitsByRef = new Map();
  for (const entry of sourceRefs) commitsByRef.set(entry.ref, await commitsForHistoriaRef(vault, entry.ref));

  let checkpoints = checkpointMap(db);
  if (!refs?.length) {
    const currentRefs = new Set(sourceRefs.map((entry) => entry.ref));
    const indexedRefs = new Set(db.query("SELECT source_ref FROM chat_sources").all().map((row) => row.source_ref));
    if ([...indexedRefs].some((ref) => !currentRefs.has(ref))) reset = true;
  }
  for (const entry of sourceRefs) {
    const checkpoint = checkpoints.get(entry.ref);
    if (checkpoint && !commitsByRef.get(entry.ref).includes(checkpoint)) reset = true;
  }

  if (reset) {
    clearChatIndex(db);
    checkpoints = new Map();
  }

  const statements = createStatements(db);
  const stats = {
    vault: vault.repository,
    database: databasePath,
    rebuilt: reset,
    refs: sourceRefs.length,
    commits: 0,
    imports: 0,
    new_revisions: 0,
    indexed_documents: 0,
    conversation_observations: 0,
    message_observations: 0
  };

  try {
    for (const entry of sourceRefs) {
      const commits = commitsByRef.get(entry.ref) ?? [];
      const checkpoint = checkpoints.get(entry.ref);
      const start = checkpoint ? commits.indexOf(checkpoint) + 1 : 0;
      for (const commitOid of commits.slice(Math.max(0, start))) {
        const metadata = await historiaCommitMetadata(vault, commitOid);
        const changedPaths = await changedHistoriaPaths(vault, commitOid, metadata.parents[0] ?? null);
        const result = await indexCommit({ vault, db, sourceRef: entry.ref, commitOid, metadata, changedPaths, statements });
        stats.commits += 1;
        stats.imports += result.imports;
        stats.new_revisions += result.newRevisions;
        stats.indexed_documents += result.indexedDocuments;
        stats.conversation_observations += result.conversationObservations;
        stats.message_observations += result.messageObservations;
      }
    }
    stats.counts = chatIndexCounts(db);
    return stats;
  } finally {
    db.close();
  }
}
