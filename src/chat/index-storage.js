import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { defaultHistoriaIndexPath } from "./paths.js";
export { defaultHistoriaIndexPath } from "./paths.js";

export const CHAT_INDEX_SCHEMA_VERSION = 2;

const MIGRATIONS = [
  `
  CREATE TABLE chat_sources (
    source_ref TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    completeness TEXT NOT NULL,
    head_commit_oid TEXT NOT NULL,
    first_indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE chat_commits (
    source_ref TEXT NOT NULL REFERENCES chat_sources(source_ref) ON DELETE CASCADE,
    commit_oid TEXT NOT NULL,
    parent_oid TEXT,
    authored_at TEXT,
    committed_at TEXT,
    message TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (source_ref, commit_oid)
  );

  CREATE TABLE chat_imports (
    source_ref TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    receipt_path TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    archive_sha256 TEXT NOT NULL,
    observed_at TEXT,
    previous_commit_oid TEXT,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY (source_ref, commit_oid, receipt_path),
    FOREIGN KEY (source_ref, commit_oid) REFERENCES chat_commits(source_ref, commit_oid) ON DELETE CASCADE
  );

  CREATE TABLE chat_conversations (
    hid TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    first_seen_at TEXT,
    last_seen_at TEXT
  );

  CREATE TABLE chat_conversation_observations (
    source_ref TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    conversation_hid TEXT NOT NULL REFERENCES chat_conversations(hid) ON DELETE CASCADE,
    manifest_path TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    observed_at TEXT,
    raw_oid TEXT,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    active_path_json TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    PRIMARY KEY (source_ref, commit_oid, conversation_hid),
    FOREIGN KEY (source_ref, commit_oid) REFERENCES chat_commits(source_ref, commit_oid) ON DELETE CASCADE
  );

  CREATE TABLE chat_message_identities (
    hid TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    conversation_hid TEXT NOT NULL REFERENCES chat_conversations(hid) ON DELETE CASCADE,
    role TEXT NOT NULL,
    author_kind TEXT NOT NULL
  );

  CREATE TABLE chat_message_revisions (
    revision_oid TEXT PRIMARY KEY,
    message_hid TEXT NOT NULL REFERENCES chat_message_identities(hid) ON DELETE CASCADE,
    role TEXT NOT NULL,
    author_json TEXT NOT NULL,
    model TEXT,
    created_at TEXT,
    updated_at TEXT,
    content_text TEXT NOT NULL,
    message_json TEXT NOT NULL,
    raw_oid TEXT,
    token_estimate INTEGER NOT NULL
  );

  CREATE TABLE chat_message_observations (
    source_ref TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    conversation_hid TEXT NOT NULL REFERENCES chat_conversations(hid) ON DELETE CASCADE,
    message_hid TEXT NOT NULL REFERENCES chat_message_identities(hid) ON DELETE CASCADE,
    revision_oid TEXT NOT NULL REFERENCES chat_message_revisions(revision_oid) ON DELETE CASCADE,
    node_id TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    active_position INTEGER,
    observed_at TEXT,
    manifest_path TEXT NOT NULL,
    message_path TEXT NOT NULL,
    PRIMARY KEY (source_ref, commit_oid, conversation_hid, message_hid),
    FOREIGN KEY (source_ref, commit_oid) REFERENCES chat_commits(source_ref, commit_oid) ON DELETE CASCADE
  );

  CREATE TABLE chat_edges (
    source_ref TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    conversation_hid TEXT NOT NULL REFERENCES chat_conversations(hid) ON DELETE CASCADE,
    from_message_hid TEXT NOT NULL,
    to_message_hid TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (source_ref, commit_oid, conversation_hid, from_message_hid, to_message_hid, kind),
    FOREIGN KEY (source_ref, commit_oid) REFERENCES chat_commits(source_ref, commit_oid) ON DELETE CASCADE
  );

  CREATE TABLE chat_message_documents (
    revision_oid TEXT PRIMARY KEY REFERENCES chat_message_revisions(revision_oid) ON DELETE CASCADE,
    message_hid TEXT NOT NULL,
    conversation_hid TEXT NOT NULL,
    title TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE chat_message_search USING fts5(
    revision_oid UNINDEXED,
    message_hid UNINDEXED,
    conversation_hid UNINDEXED,
    title,
    role,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE chat_index_checkpoints (
    source_ref TEXT PRIMARY KEY,
    last_commit_oid TEXT,
    generation INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX chat_sources_key ON chat_sources(provider, source_key);
  CREATE INDEX chat_commits_time ON chat_commits(committed_at, commit_oid);
  CREATE INDEX chat_imports_archive ON chat_imports(archive_sha256);
  CREATE INDEX chat_conversation_observations_time ON chat_conversation_observations(conversation_hid, observed_at);
  CREATE INDEX chat_conversation_observations_title ON chat_conversation_observations(title);
  CREATE INDEX chat_message_revisions_identity ON chat_message_revisions(message_hid, created_at);
  CREATE INDEX chat_message_observations_revision ON chat_message_observations(revision_oid);
  CREATE INDEX chat_message_observations_conversation ON chat_message_observations(conversation_hid, source_ref, commit_oid, active_position);
  CREATE INDEX chat_edges_from ON chat_edges(conversation_hid, from_message_hid);
  CREATE INDEX chat_edges_to ON chat_edges(conversation_hid, to_message_hid);
  `,
  `
  CREATE TABLE chat_text_graphs (
    graph_id TEXT PRIMARY KEY,
    revision_oid TEXT NOT NULL REFERENCES chat_message_revisions(revision_oid) ON DELETE CASCADE,
    analyzer_name TEXT NOT NULL,
    analyzer_version TEXT NOT NULL,
    analyzer_fingerprint TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (revision_oid, analyzer_fingerprint)
  );

  CREATE TABLE chat_text_graph_anchors (
    graph_id TEXT NOT NULL REFERENCES chat_text_graphs(graph_id) ON DELETE CASCADE,
    anchor_id TEXT NOT NULL,
    revision_oid TEXT NOT NULL,
    block_index INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL,
    exact_sha256 TEXT NOT NULL,
    exact_text TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (graph_id, anchor_id)
  );

  CREATE TABLE chat_text_graph_nodes (
    graph_id TEXT NOT NULL REFERENCES chat_text_graphs(graph_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    structural_hash TEXT NOT NULL,
    properties_json TEXT NOT NULL,
    PRIMARY KEY (graph_id, node_id)
  );

  CREATE TABLE chat_text_graph_node_anchors (
    graph_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    anchor_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (graph_id, node_id, anchor_id, role),
    FOREIGN KEY (graph_id, node_id) REFERENCES chat_text_graph_nodes(graph_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (graph_id, anchor_id) REFERENCES chat_text_graph_anchors(graph_id, anchor_id) ON DELETE CASCADE
  );

  CREATE TABLE chat_text_graph_edges (
    graph_id TEXT NOT NULL REFERENCES chat_text_graphs(graph_id) ON DELETE CASCADE,
    edge_id TEXT NOT NULL,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    kind TEXT NOT NULL,
    confidence REAL NOT NULL,
    resolution TEXT NOT NULL,
    anchor_ids_json TEXT NOT NULL,
    properties_json TEXT NOT NULL,
    PRIMARY KEY (graph_id, edge_id),
    FOREIGN KEY (graph_id, from_node_id) REFERENCES chat_text_graph_nodes(graph_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (graph_id, to_node_id) REFERENCES chat_text_graph_nodes(graph_id, node_id) ON DELETE CASCADE
  );

  CREATE INDEX chat_text_graphs_revision ON chat_text_graphs(revision_oid, analyzer_fingerprint);
  CREATE INDEX chat_text_graph_nodes_kind ON chat_text_graph_nodes(layer, kind, graph_id);
  CREATE INDEX chat_text_graph_nodes_structure ON chat_text_graph_nodes(structural_hash);
  CREATE INDEX chat_text_graph_anchors_revision ON chat_text_graph_anchors(revision_oid, block_index, start_byte);
  CREATE INDEX chat_text_graph_edges_kind ON chat_text_graph_edges(layer, kind, graph_id);
  CREATE INDEX chat_text_graph_edges_from ON chat_text_graph_edges(graph_id, from_node_id);
  CREATE INDEX chat_text_graph_edges_to ON chat_text_graph_edges(graph_id, to_node_id);
  `
];

export async function openChatIndex(databasePath = defaultHistoriaIndexPath()) {
  const path = resolve(databasePath);
  await mkdir(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -100000; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS historia_chat_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const current = Number(db.query("SELECT COALESCE(MAX(version), 0) AS version FROM historia_chat_schema_migrations").get().version);
  for (let index = current; index < MIGRATIONS.length; index += 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[index]);
      db.query("INSERT INTO historia_chat_schema_migrations(version) VALUES (?)").run(index + 1);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  return db;
}

export function clearChatIndex(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM chat_text_graph_node_anchors;
      DELETE FROM chat_text_graph_edges;
      DELETE FROM chat_text_graph_nodes;
      DELETE FROM chat_text_graph_anchors;
      DELETE FROM chat_text_graphs;
      DELETE FROM chat_message_search;
      DELETE FROM chat_message_documents;
      DELETE FROM chat_edges;
      DELETE FROM chat_message_observations;
      DELETE FROM chat_message_revisions;
      DELETE FROM chat_message_identities;
      DELETE FROM chat_conversation_observations;
      DELETE FROM chat_conversations;
      DELETE FROM chat_imports;
      DELETE FROM chat_commits;
      DELETE FROM chat_sources;
      DELETE FROM chat_index_checkpoints;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function chatIndexCounts(db) {
  const count = (table) => Number(db.query(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return {
    sources: count("chat_sources"),
    commits: count("chat_commits"),
    imports: count("chat_imports"),
    conversations: count("chat_conversations"),
    conversation_observations: count("chat_conversation_observations"),
    message_identities: count("chat_message_identities"),
    message_revisions: count("chat_message_revisions"),
    message_observations: count("chat_message_observations"),
    edges: count("chat_edges"),
    text_graphs: count("chat_text_graphs"),
    text_graph_nodes: count("chat_text_graph_nodes"),
    text_graph_edges: count("chat_text_graph_edges")
  };
}
