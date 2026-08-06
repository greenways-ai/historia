import { canonicalJson } from "./identity.js";
import {
  BASIC_TEXT_GRAPH_ANALYZER,
  analyzeMessageTextGraph,
  projectTextGraph
} from "./text-graph.js";

function jsonText(value) {
  return canonicalJson(value, { newline: false });
}

function statements(db) {
  return {
    getGraph: db.query("SELECT graph_id FROM chat_text_graphs WHERE graph_id = ?"),
    insertGraph: db.query(`
      INSERT INTO chat_text_graphs(
        graph_id, revision_oid, analyzer_name, analyzer_version, analyzer_fingerprint,
        source_sha256, graph_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertAnchor: db.query(`
      INSERT INTO chat_text_graph_anchors(
        graph_id, anchor_id, revision_oid, block_index, start_byte, end_byte,
        exact_sha256, exact_text, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertNode: db.query(`
      INSERT INTO chat_text_graph_nodes(
        graph_id, node_id, layer, kind, label, source_hash, structural_hash, properties_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertNodeAnchor: db.query(`
      INSERT INTO chat_text_graph_node_anchors(graph_id, node_id, anchor_id, role)
      VALUES (?, ?, ?, ?)
    `),
    insertEdge: db.query(`
      INSERT INTO chat_text_graph_edges(
        graph_id, edge_id, from_node_id, to_node_id, layer, kind, confidence,
        resolution, anchor_ids_json, properties_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  };
}

export function persistMessageTextGraph(db, graph, prepared = statements(db)) {
  if (prepared.getGraph.get(graph.graph_id)) return false;
  prepared.insertGraph.run(
    graph.graph_id,
    graph.document.revision_oid,
    graph.analyzer.name,
    graph.analyzer.version,
    graph.analyzer.fingerprint,
    graph.document.source_sha256,
    jsonText(graph)
  );
  for (const anchor of graph.anchors ?? []) {
    prepared.insertAnchor.run(
      graph.graph_id,
      anchor.anchor_id,
      anchor.revision_oid,
      anchor.block_index,
      anchor.start_byte,
      anchor.end_byte,
      anchor.exact_sha256,
      anchor.exact,
      anchor.role ?? "evidence"
    );
  }
  for (const node of graph.nodes ?? []) {
    prepared.insertNode.run(
      graph.graph_id,
      node.node_id,
      node.layer,
      node.kind,
      node.label,
      node.source_hash,
      node.structural_hash,
      jsonText(node.properties ?? {})
    );
    for (const anchorId of node.anchor_ids ?? []) {
      prepared.insertNodeAnchor.run(graph.graph_id, node.node_id, anchorId, "evidence");
    }
  }
  for (const edge of graph.edges ?? []) {
    prepared.insertEdge.run(
      graph.graph_id,
      edge.edge_id,
      edge.from,
      edge.to,
      edge.layer,
      edge.kind,
      edge.confidence ?? 1,
      edge.resolution ?? "parsed",
      jsonText(edge.anchor_ids ?? []),
      jsonText(edge.properties ?? {})
    );
  }
  return true;
}

export function indexMissingMessageTextGraphs(db, {
  analyzerFingerprint = BASIC_TEXT_GRAPH_ANALYZER.fingerprint,
  limit = 100_000
} = {}) {
  if (analyzerFingerprint !== BASIC_TEXT_GRAPH_ANALYZER.fingerprint) {
    throw new Error(`unsupported built-in text graph analyzer fingerprint: ${analyzerFingerprint}`);
  }
  const resultLimit = Math.max(1, Math.min(1_000_000, Number(limit) || 100_000));
  const rows = db.query(`
    SELECT r.revision_oid, r.message_json
    FROM chat_message_revisions r
    WHERE NOT EXISTS (
      SELECT 1 FROM chat_text_graphs g
      WHERE g.revision_oid = r.revision_oid AND g.analyzer_fingerprint = ?
    )
    ORDER BY r.rowid
    LIMIT ?
  `).all(analyzerFingerprint, resultLimit);
  if (!rows.length) {
    return { indexed: 0, analyzer_fingerprint: analyzerFingerprint };
  }

  const prepared = statements(db);
  let indexed = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      let message;
      try { message = JSON.parse(row.message_json); }
      catch (error) { throw new Error(`invalid normalized message JSON for ${row.revision_oid}: ${error.message}`); }
      const graph = analyzeMessageTextGraph(message, { revisionOid: row.revision_oid });
      if (persistMessageTextGraph(db, graph, prepared)) indexed += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { indexed, analyzer_fingerprint: analyzerFingerprint };
}

export function loadMessageTextGraph(db, identifier, {
  analyzerFingerprint = BASIC_TEXT_GRAPH_ANALYZER.fingerprint,
  projection = "all"
} = {}) {
  const row = db.query(`
    SELECT g.graph_json
    FROM chat_text_graphs g
    JOIN chat_message_revisions r ON r.revision_oid = g.revision_oid
    WHERE g.analyzer_fingerprint = ?
      AND (g.graph_id = ? OR g.revision_oid = ? OR r.message_hid = ?)
    ORDER BY COALESCE(r.updated_at, r.created_at, '') DESC, g.created_at DESC
    LIMIT 1
  `).get(analyzerFingerprint, identifier, identifier, identifier);
  if (!row) return null;
  const graph = JSON.parse(row.graph_json);
  return projectTextGraph(graph, projection);
}

export function textGraphCounts(db) {
  const count = (table) => Number(db.query(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return {
    graphs: count("chat_text_graphs"),
    anchors: count("chat_text_graph_anchors"),
    nodes: count("chat_text_graph_nodes"),
    edges: count("chat_text_graph_edges")
  };
}
