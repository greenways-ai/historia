import { canonicalJson, sha256 } from "./identity.js";

export const CHAT_TOPIC_INDEX_SCHEMA = "historia.chat.topic-index/0-alpha";

const EXTRACTOR_NAME = "historia-graph-topic-index";
const EXTRACTOR_VERSION = "0.1.0";
const RULESET_VERSION = "2026-08-06.1";

const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "because",
  "been", "before", "being", "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing", "for",
  "from", "get", "got", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i",
  "if", "in", "into", "is", "it", "its", "just", "let", "like", "may", "me", "might", "more", "most", "must",
  "my", "need", "no", "not", "of", "on", "or", "our", "ours", "out", "over", "please", "should", "so", "some",
  "such", "than", "that", "the", "their", "theirs", "them", "then", "there", "these", "they", "this", "those", "to",
  "too", "under", "up", "us", "use", "using", "very", "want", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your", "yours"
]);

const GENERIC_WORDS = new Set([
  "actually", "another", "better", "change", "changes", "current", "different", "example", "first", "going", "good",
  "great", "idea", "ideas", "look", "make", "making", "new", "one", "part", "really", "same", "something", "stuff",
  "thing", "things", "think", "version", "way", "work", "working"
]);

const PHRASE_BOUNDARY_WORDS = new Set([
  ...STOP_WORDS,
  ...GENERIC_WORDS,
  "add", "adds", "added", "build", "builds", "built", "become", "becomes",
  "create", "creates", "created", "keep", "keeps", "link", "links", "linked",
  "manage", "manages", "managed", "make", "makes", "made", "provide", "provides",
  "provided", "store", "stores", "stored", "use", "uses", "used"
]);

const REFERENCE_WEIGHTS = Object.freeze({
  project: 1.7,
  repository: 1.6,
  package: 1.35,
  path: 1.3,
  url: 1.1,
  entity: 1.2
});

const FACET_WEIGHTS = Object.freeze({
  decision: 1.35,
  constraint: 1.3,
  rejection: 1.25,
  acceptance: 1.2,
  proposal: 1.16,
  request: 1.14,
  correction: 1.12,
  status: 1.1,
  rationale: 1.08,
  question: 1.05
});

function jsonText(value) {
  return canonicalJson(value, { newline: false });
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

export function normalizeTopicText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@/._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function topicWords(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
}

function ftsQuery(query) {
  const terms = String(query ?? "").normalize("NFKC").match(/[\p{L}\p{N}_./:@-]+/gu) ?? [];
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function topicIdFor(kind, normalizedKey) {
  return `historia:topic:${sha256({ kind, normalized_key: normalizedKey })}`;
}

function canonicalPair(left, right) {
  return left < right ? [left, right] : [right, left];
}

function topicExtractorDescriptor() {
  return {
    name: EXTRACTOR_NAME,
    version: EXTRACTOR_VERSION,
    fingerprint: sha256({
      name: EXTRACTOR_NAME,
      version: EXTRACTOR_VERSION,
      ruleset: RULESET_VERSION,
      reference_weights: REFERENCE_WEIGHTS,
      facet_weights: FACET_WEIGHTS,
      stop_words: [...STOP_WORDS].sort(),
      generic_words: [...GENERIC_WORDS].sort()
    })
  };
}

export const BASIC_TOPIC_EXTRACTOR = Object.freeze(topicExtractorDescriptor());

function facetBoost(facets) {
  return Math.max(1, ...facets.map((facet) => FACET_WEIGHTS[facet] ?? 1));
}

function phraseCandidates(text, excluded = new Set()) {
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const word of topicWords(text)) {
    if (word.length < 3 || PHRASE_BOUNDARY_WORDS.has(word)) {
      flush();
      continue;
    }
    current.push(word);
  }
  flush();

  const candidates = [];
  const seen = new Set();
  const add = (kind, values, weight) => {
    const label = values.join(" ");
    if (!label || excluded.has(normalizeTopicText(label)) || seen.has(`${kind}\0${label}`)) return;
    seen.add(`${kind}\0${label}`);
    candidates.push({ kind, label, normalized_key: label, weight });
  };
  for (const segment of segments) {
    if (segment.length === 1) {
      if (segment[0].length >= 5) add("keyword", segment, 0.68);
      continue;
    }
    if (segment.length <= 4) {
      add("phrase", segment, 1.04 + (segment.length - 2) * 0.12);
      continue;
    }
    for (let index = 0; index + 4 <= segment.length; index += 1) {
      add("phrase", segment.slice(index, index + 4), 1.28);
      if (candidates.length >= 8) return candidates;
    }
  }
  return candidates.slice(0, 8);
}

function referenceTopic(node) {
  const canonical = node?.properties?.canonical_key ?? `${node.kind}:${normalizeTopicText(node.label)}`;
  const normalizedKey = normalizeTopicText(canonical);
  if (!normalizedKey) return null;
  const aliases = [node.label, node.properties?.matched_alias, canonical].filter(Boolean).map((value) => String(value));
  return {
    kind: node.kind ?? "entity",
    label: String(node.label ?? canonical),
    normalized_key: normalizedKey,
    aliases,
    weight: REFERENCE_WEIGHTS[node.kind] ?? REFERENCE_WEIGHTS.entity
  };
}

function mergeMention(map, mention) {
  const key = [mention.topic_id, mention.graph_node_id, mention.context_node_id ?? "", mention.relation].join("\0");
  const current = map.get(key);
  if (!current) {
    map.set(key, mention);
    return;
  }
  current.weight = Math.max(current.weight, mention.weight);
  current.anchor_ids = [...new Set([...current.anchor_ids, ...mention.anchor_ids])].sort();
  current.support_node_ids = [...new Set([...current.support_node_ids, ...mention.support_node_ids])].sort();
  current.facets = [...new Set([...current.facets, ...mention.facets])].sort();
  current.aliases = [...new Set([...current.aliases, ...mention.aliases])].sort();
}

export function topicsFromTextGraph(graph) {
  if (!graph || typeof graph !== "object") throw new Error("a Historia text graph is required");
  const nodes = new Map((graph.nodes ?? []).map((node) => [node.node_id, node]));
  const propositionIds = new Set((graph.nodes ?? []).filter((node) => node.layer === "semantic" && node.kind === "proposition").map((node) => node.node_id));
  const referencesByProposition = new Map();
  const facetsByProposition = new Map();
  const facetNodesByProposition = new Map();

  for (const edge of graph.edges ?? []) {
    if (edge.kind === "semantic:about" && propositionIds.has(edge.from)) {
      const values = referencesByProposition.get(edge.from) ?? [];
      values.push(edge.to);
      referencesByProposition.set(edge.from, values);
    }
    if (edge.kind?.endsWith(":qualifies") && propositionIds.has(edge.to)) {
      const source = nodes.get(edge.from);
      if (!source || !new Set(["discourse", "work"]).has(source.layer)) continue;
      const facets = facetsByProposition.get(edge.to) ?? new Set();
      facets.add(source.kind);
      facetsByProposition.set(edge.to, facets);
      const facetNodes = facetNodesByProposition.get(edge.to) ?? new Set();
      facetNodes.add(source.node_id);
      facetNodesByProposition.set(edge.to, facetNodes);
    }
  }

  const mentions = new Map();
  const referencedNodes = new Set();
  const add = ({ topic, graphNode, contextNode, relation, facets = [], supportNodeIds = [] }) => {
    if (!topic || !graphNode) return;
    const normalizedKey = normalizeTopicText(topic.normalized_key ?? topic.label);
    if (!normalizedKey) return;
    const topicId = topicIdFor(topic.kind, normalizedKey);
    const boost = facetBoost(facets);
    mergeMention(mentions, {
      topic_id: topicId,
      kind: topic.kind,
      normalized_key: normalizedKey,
      label: topic.label,
      aliases: [...new Set([topic.label, ...(topic.aliases ?? [])].filter(Boolean).map(String))].sort(),
      graph_id: graph.graph_id,
      graph_node_id: graphNode.node_id,
      context_node_id: contextNode?.node_id ?? graphNode.node_id,
      revision_oid: graph.document.revision_oid,
      message_hid: graph.document.message_hid ?? null,
      relation,
      weight: Number((topic.weight * boost).toFixed(6)),
      anchor_ids: [...new Set(graphNode.anchor_ids ?? [])].sort(),
      support_node_ids: [...new Set([graphNode.node_id, contextNode?.node_id, ...supportNodeIds].filter(Boolean))].sort(),
      facets: [...new Set(facets)].sort()
    });
  };

  for (const propositionId of [...propositionIds].sort()) {
    const proposition = nodes.get(propositionId);
    const facets = [...(facetsByProposition.get(propositionId) ?? [])].sort();
    const facetNodeIds = [...(facetNodesByProposition.get(propositionId) ?? [])].sort();
    const excludedPhrases = new Set();
    for (const referenceId of [...new Set(referencesByProposition.get(propositionId) ?? [])].sort()) {
      const reference = nodes.get(referenceId);
      if (!reference) continue;
      const topic = referenceTopic(reference);
      referencedNodes.add(referenceId);
      for (const alias of [topic?.label, ...(topic?.aliases ?? [])]) {
        const normalized = normalizeTopicText(alias);
        if (normalized) excludedPhrases.add(normalized);
      }
      add({
        topic,
        graphNode: reference,
        contextNode: proposition,
        relation: "reference",
        facets,
        supportNodeIds: facetNodeIds
      });
    }
    for (const topic of phraseCandidates(proposition.label, excludedPhrases)) {
      add({
        topic,
        graphNode: proposition,
        contextNode: proposition,
        relation: "phrase",
        facets,
        supportNodeIds: facetNodeIds
      });
    }
  }

  for (const node of graph.nodes ?? []) {
    if (node.layer !== "reference" || referencedNodes.has(node.node_id)) continue;
    add({ topic: referenceTopic(node), graphNode: node, contextNode: node, relation: "reference" });
  }

  return [...mentions.values()].sort((left, right) => left.topic_id.localeCompare(right.topic_id)
    || left.graph_node_id.localeCompare(right.graph_node_id)
    || left.relation.localeCompare(right.relation));
}

function preparedStatements(db) {
  return {
    graphCheckpoint: db.query(`
      SELECT graph_id FROM chat_topic_graph_checkpoints
      WHERE graph_id = ? AND extractor_fingerprint = ?
    `),
    getMessageContext: db.query(`
      SELECT r.message_hid, i.conversation_hid
      FROM chat_message_revisions r
      JOIN chat_message_identities i ON i.hid = r.message_hid
      WHERE r.revision_oid = ?
    `),
    getTopic: db.query("SELECT topic_id, label, aliases_json FROM chat_topics WHERE topic_id = ?"),
    upsertTopic: db.query(`
      INSERT INTO chat_topics(topic_id, kind, normalized_key, label, aliases_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(topic_id) DO UPDATE SET
        label = excluded.label,
        aliases_json = excluded.aliases_json
    `),
    deleteTopicSearch: db.query("DELETE FROM chat_topic_search WHERE topic_id = ?"),
    insertTopicSearch: db.query(`
      INSERT INTO chat_topic_search(topic_id, label, normalized_key, aliases)
      VALUES (?, ?, ?, ?)
    `),
    insertMention: db.query(`
      INSERT OR REPLACE INTO chat_topic_mentions(
        topic_id, graph_id, graph_node_id, context_node_id, revision_oid, message_hid,
        conversation_hid, relation, weight, anchor_ids_json, support_node_ids_json,
        facets_json, extractor_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertCheckpoint: db.query(`
      INSERT OR REPLACE INTO chat_topic_graph_checkpoints(graph_id, extractor_fingerprint)
      VALUES (?, ?)
    `)
  };
}

function mergedAliases(current, incoming) {
  const values = new Set(incoming.map(String));
  for (const value of parseJson(current?.aliases_json, [])) values.add(String(value));
  return [...values].filter(Boolean).sort();
}

export function persistTextGraphTopics(db, graph, prepared = preparedStatements(db)) {
  const extractor = BASIC_TOPIC_EXTRACTOR;
  if (prepared.graphCheckpoint.get(graph.graph_id, extractor.fingerprint)) return false;
  const context = prepared.getMessageContext.get(graph.document.revision_oid);
  if (!context) throw new Error(`text graph ${graph.graph_id} references an unknown message revision`);
  const mentions = topicsFromTextGraph(graph);
  for (const mention of mentions) {
    const current = prepared.getTopic.get(mention.topic_id);
    const aliases = mergedAliases(current, mention.aliases);
    const label = current?.label ?? mention.label;
    prepared.upsertTopic.run(
      mention.topic_id,
      mention.kind,
      mention.normalized_key,
      label,
      jsonText(aliases)
    );
    prepared.deleteTopicSearch.run(mention.topic_id);
    prepared.insertTopicSearch.run(mention.topic_id, label, mention.normalized_key, aliases.join(" "));
    prepared.insertMention.run(
      mention.topic_id,
      mention.graph_id,
      mention.graph_node_id,
      mention.context_node_id,
      mention.revision_oid,
      context.message_hid,
      context.conversation_hid,
      mention.relation,
      mention.weight,
      jsonText(mention.anchor_ids),
      jsonText(mention.support_node_ids),
      jsonText(mention.facets),
      extractor.fingerprint
    );
  }
  prepared.insertCheckpoint.run(graph.graph_id, extractor.fingerprint);
  return true;
}

export function clearTopicProjection(db) {
  db.exec(`
    DELETE FROM chat_topic_index_state;
    DELETE FROM chat_topic_search;
    DELETE FROM chat_topic_edges;
    DELETE FROM chat_topic_mentions;
    DELETE FROM chat_topic_graph_checkpoints;
    DELETE FROM chat_topics;
  `);
}

function refreshTopicStatistics(db, extractorFingerprint) {
  const rows = db.query(`
    SELECT t.topic_id,
           COUNT(m.topic_id) AS mention_count,
           COUNT(DISTINCT m.revision_oid) AS document_frequency,
           MIN(COALESCE(r.created_at, r.updated_at)) AS first_seen_at,
           MAX(COALESCE(r.updated_at, r.created_at)) AS last_seen_at
    FROM chat_topics t
    LEFT JOIN chat_topic_mentions m
      ON m.topic_id = t.topic_id AND m.extractor_fingerprint = ?
    LEFT JOIN chat_message_revisions r ON r.revision_oid = m.revision_oid
    GROUP BY t.topic_id
  `).all(extractorFingerprint);
  const update = db.query(`
    UPDATE chat_topics
    SET mention_count = ?, document_frequency = ?, first_seen_at = ?, last_seen_at = ?
    WHERE topic_id = ?
  `);
  for (const row of rows) {
    update.run(Number(row.mention_count), Number(row.document_frequency), row.first_seen_at ?? null, row.last_seen_at ?? null, row.topic_id);
  }
}

function collapsedTopics(rows, maximum) {
  const byTopic = new Map();
  for (const row of rows) {
    const current = byTopic.get(row.topic_id);
    const weight = Number(row.weight) || 0;
    if (!current || weight > current.weight) byTopic.set(row.topic_id, { ...row, weight });
  }
  return [...byTopic.values()].sort((left, right) => right.weight - left.weight || left.topic_id.localeCompare(right.topic_id)).slice(0, maximum);
}

function addAssociation(accumulator, left, right, contribution, evidence) {
  if (!left || !right || left.topic_id === right.topic_id || contribution <= 0) return;
  const [leftId, rightId] = canonicalPair(left.topic_id, right.topic_id);
  const key = `${leftId}\0${rightId}`;
  const current = accumulator.get(key) ?? {
    left_topic_id: leftId,
    right_topic_id: rightId,
    weighted_support: 0,
    evidence: new Map()
  };
  current.weighted_support += contribution;
  const evidenceKey = jsonText(evidence);
  const previous = current.evidence.get(evidenceKey);
  if (!previous || contribution > previous.contribution) current.evidence.set(evidenceKey, { ...evidence, contribution });
  accumulator.set(key, current);
}

function replyEdgeCount(db) {
  return Number(db.query(`
    SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT conversation_hid, from_message_hid, to_message_hid, kind
      FROM chat_edges
    )
  `).get().count);
}

function topicProjectionState(db) {
  return db.query(`
    SELECT extractor_fingerprint, graph_count, reply_edge_count, association_count
    FROM chat_topic_index_state WHERE singleton = 1
  `).get() ?? null;
}

function activeGraphCount(db, extractorFingerprint) {
  return Number(db.query(`
    SELECT COUNT(*) AS count FROM chat_topic_graph_checkpoints
    WHERE extractor_fingerprint = ?
  `).get(extractorFingerprint).count);
}

export function rebuildTopicAssociations(db, {
  extractorFingerprint = BASIC_TOPIC_EXTRACTOR.fingerprint
} = {}) {
  const rows = db.query(`
    SELECT topic_id, graph_id, graph_node_id, context_node_id, revision_oid,
           message_hid, conversation_hid, relation, weight, facets_json
    FROM chat_topic_mentions
    WHERE extractor_fingerprint = ?
    ORDER BY graph_id, context_node_id, topic_id
  `).all(extractorFingerprint);
  const byContext = new Map();
  const byGraph = new Map();
  const byMessage = new Map();
  for (const row of rows) {
    const contextKey = `${row.graph_id}\0${row.context_node_id ?? row.graph_node_id}`;
    const contextRows = byContext.get(contextKey) ?? [];
    contextRows.push(row);
    byContext.set(contextKey, contextRows);
    const graphRows = byGraph.get(row.graph_id) ?? [];
    graphRows.push(row);
    byGraph.set(row.graph_id, graphRows);
    const messageRows = byMessage.get(row.message_hid) ?? [];
    messageRows.push(row);
    byMessage.set(row.message_hid, messageRows);
  }

  const associations = new Map();
  for (const [contextKey, contextRows] of byContext) {
    const values = collapsedTopics(contextRows, 24);
    for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
        const left = values[leftIndex];
        const right = values[rightIndex];
        addAssociation(associations, left, right, 4 * Math.sqrt(left.weight * right.weight), {
          relation: "same-proposition",
          graph_id: left.graph_id,
          context_node_id: left.context_node_id,
          revision_oid: left.revision_oid,
          message_hid: left.message_hid,
          context_key: contextKey
        });
      }
    }
  }
  for (const graphRows of byGraph.values()) {
    const values = collapsedTopics(graphRows, 36);
    for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
        const left = values[leftIndex];
        const right = values[rightIndex];
        addAssociation(associations, left, right, 0.75 * Math.sqrt(left.weight * right.weight), {
          relation: "same-message",
          graph_id: left.graph_id,
          revision_oid: left.revision_oid,
          message_hid: left.message_hid
        });
      }
    }
  }

  const replies = db.query(`
    SELECT DISTINCT conversation_hid, from_message_hid, to_message_hid
    FROM chat_edges
    ORDER BY conversation_hid, from_message_hid, to_message_hid
  `).all();
  for (const reply of replies) {
    const leftValues = collapsedTopics(byMessage.get(reply.from_message_hid) ?? [], 18);
    const rightValues = collapsedTopics(byMessage.get(reply.to_message_hid) ?? [], 18);
    for (const left of leftValues) {
      for (const right of rightValues) {
        addAssociation(associations, left, right, 1.5 * Math.sqrt(left.weight * right.weight), {
          relation: "direct-reply",
          conversation_hid: reply.conversation_hid,
          from_message_hid: reply.from_message_hid,
          to_message_hid: reply.to_message_hid
        });
      }
    }
  }

  const frequencies = new Map(db.query("SELECT topic_id, document_frequency FROM chat_topics").all()
    .map((row) => [row.topic_id, Math.max(1, Number(row.document_frequency) || 1)]));
  const insert = db.query(`
    INSERT INTO chat_topic_edges(
      left_topic_id, right_topic_id, extractor_fingerprint, weighted_support,
      support_count, association_score, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const writeState = db.query(`
    INSERT INTO chat_topic_index_state(
      singleton, extractor_fingerprint, graph_count, reply_edge_count,
      association_count, updated_at
    ) VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(singleton) DO UPDATE SET
      extractor_fingerprint = excluded.extractor_fingerprint,
      graph_count = excluded.graph_count,
      reply_edge_count = excluded.reply_edge_count,
      association_count = excluded.association_count,
      updated_at = CURRENT_TIMESTAMP
  `);
  const graphCount = activeGraphCount(db, extractorFingerprint);
  const currentReplyEdgeCount = replyEdgeCount(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.query("DELETE FROM chat_topic_edges WHERE extractor_fingerprint = ?").run(extractorFingerprint);
    for (const association of [...associations.values()].sort((left, right) => left.left_topic_id.localeCompare(right.left_topic_id) || left.right_topic_id.localeCompare(right.right_topic_id))) {
      const frequencyScale = Math.sqrt((frequencies.get(association.left_topic_id) ?? 1) * (frequencies.get(association.right_topic_id) ?? 1));
      const raw = association.weighted_support / frequencyScale;
      const score = 1 - Math.exp(-raw / 3);
      const evidence = [...association.evidence.values()]
        .sort((left, right) => right.contribution - left.contribution || jsonText(left).localeCompare(jsonText(right)))
        .slice(0, 16);
      insert.run(
        association.left_topic_id,
        association.right_topic_id,
        extractorFingerprint,
        Number(association.weighted_support.toFixed(6)),
        association.evidence.size,
        Number(score.toFixed(6)),
        jsonText(evidence)
      );
    }
    writeState.run(extractorFingerprint, graphCount, currentReplyEdgeCount, associations.size);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { edges: associations.size, extractor_fingerprint: extractorFingerprint };
}

export function indexMissingGraphTopics(db, {
  limit = 100_000,
  rebuild = false,
  extractorFingerprint = BASIC_TOPIC_EXTRACTOR.fingerprint
} = {}) {
  if (extractorFingerprint !== BASIC_TOPIC_EXTRACTOR.fingerprint) {
    throw new Error(`unsupported built-in topic extractor fingerprint: ${extractorFingerprint}`);
  }
  const resultLimit = Math.max(1, Math.min(1_000_000, Number(limit) || 100_000));
  const existingFingerprints = db.query(`
    SELECT DISTINCT extractor_fingerprint FROM chat_topic_graph_checkpoints
  `).all().map((row) => row.extractor_fingerprint);
  const fingerprintChanged = existingFingerprints.some((value) => value !== extractorFingerprint);
  if (rebuild || fingerprintChanged) {
    db.exec("BEGIN IMMEDIATE");
    try {
      clearTopicProjection(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const previousState = topicProjectionState(db);
  const rows = db.query(`
    SELECT graph_id, graph_json
    FROM chat_text_graphs g
    WHERE NOT EXISTS (
      SELECT 1 FROM chat_topic_graph_checkpoints c
      WHERE c.graph_id = g.graph_id AND c.extractor_fingerprint = ?
    )
    ORDER BY g.rowid
    LIMIT ?
  `).all(extractorFingerprint, resultLimit);
  const prepared = preparedStatements(db);
  let indexed = 0;
  if (rows.length) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        let graph;
        try { graph = JSON.parse(row.graph_json); }
        catch (error) { throw new Error(`invalid text graph JSON for ${row.graph_id}: ${error.message}`); }
        if (persistTextGraphTopics(db, graph, prepared)) indexed += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (indexed || rebuild || fingerprintChanged || !previousState) {
    refreshTopicStatistics(db, extractorFingerprint);
  }
  const graphCount = activeGraphCount(db, extractorFingerprint);
  const currentReplyEdgeCount = replyEdgeCount(db);
  const associationsStale = !previousState
    || previousState.extractor_fingerprint !== extractorFingerprint
    || Number(previousState.graph_count) !== graphCount
    || Number(previousState.reply_edge_count) !== currentReplyEdgeCount;
  const associations = associationsStale || indexed || rebuild || fingerprintChanged
    ? rebuildTopicAssociations(db, { extractorFingerprint })
    : {
        edges: Number(previousState.association_count),
        extractor_fingerprint: extractorFingerprint,
        cached: true
      };
  return {
    indexed,
    extractor_fingerprint: extractorFingerprint,
    associations: associations.edges,
    associations_cached: Boolean(associations.cached)
  };
}

export function topicIndexCounts(db) {
  const count = (table) => Number(db.query(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return {
    topics: count("chat_topics"),
    mentions: count("chat_topic_mentions"),
    associations: count("chat_topic_edges"),
    indexed_graphs: count("chat_topic_graph_checkpoints")
  };
}

export function searchTopics(db, query, { limit = 8 } = {}) {
  const match = ftsQuery(query);
  if (!match) return [];
  const resultLimit = Math.max(1, Math.min(100, Number(limit) || 8));
  const normalizedQuery = normalizeTopicText(query);
  const rows = db.query(`
    SELECT t.topic_id, t.kind, t.normalized_key, t.label, t.aliases_json,
           t.mention_count, t.document_frequency, t.first_seen_at, t.last_seen_at,
           bm25(chat_topic_search) AS score
    FROM chat_topic_search s
    JOIN chat_topics t ON t.topic_id = s.topic_id
    WHERE chat_topic_search MATCH ?
    ORDER BY CASE WHEN t.normalized_key = ? OR lower(t.label) = ? THEN 0 ELSE 1 END,
             score, t.document_frequency DESC, t.topic_id
    LIMIT ?
  `).all(match, normalizedQuery, normalizedQuery, resultLimit);
  return rows.map((row, index) => ({
    rank: index + 1,
    topic_id: row.topic_id,
    kind: row.kind,
    normalized_key: row.normalized_key,
    label: row.label,
    aliases: parseJson(row.aliases_json, []),
    mention_count: Number(row.mention_count),
    document_frequency: Number(row.document_frequency),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    lexical_score: row.score,
    match_strength: Number(((row.normalized_key === normalizedQuery || row.label.toLowerCase() === normalizedQuery ? 1.2 : 1) / Math.log2(index + 2)).toFixed(6))
  }));
}

export function relatedTopics(db, seeds, {
  limit = 12,
  minSupport = 1,
  extractorFingerprint = BASIC_TOPIC_EXTRACTOR.fingerprint
} = {}) {
  const seedValues = (Array.isArray(seeds) ? seeds : []).filter((seed) => seed?.topic_id);
  if (!seedValues.length) return [];
  const ids = seedValues.map((seed) => seed.topic_id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.query(`
    SELECT e.left_topic_id, e.right_topic_id, e.weighted_support, e.support_count,
           e.association_score, e.evidence_json
    FROM chat_topic_edges e
    WHERE e.extractor_fingerprint = ?
      AND e.support_count >= ?
      AND (e.left_topic_id IN (${placeholders}) OR e.right_topic_id IN (${placeholders}))
    ORDER BY e.association_score DESC, e.support_count DESC
  `).all(extractorFingerprint, Math.max(1, Number(minSupport) || 1), ...ids, ...ids);
  const seedById = new Map(seedValues.map((seed) => [seed.topic_id, seed]));
  const related = new Map();
  for (const row of rows) {
    const leftSeed = seedById.get(row.left_topic_id);
    const rightSeed = seedById.get(row.right_topic_id);
    const seed = leftSeed ?? rightSeed;
    const relatedId = leftSeed ? row.right_topic_id : row.left_topic_id;
    if (!seed || seedById.has(relatedId)) continue;
    const score = seed.match_strength * Number(row.association_score);
    const current = related.get(relatedId);
    if (!current || score > current.score) {
      related.set(relatedId, {
        topic_id: relatedId,
        seed_topic_id: seed.topic_id,
        association_score: Number(row.association_score),
        support_count: Number(row.support_count),
        weighted_support: Number(row.weighted_support),
        evidence: parseJson(row.evidence_json, []),
        score
      });
    }
  }
  const values = [...related.values()]
    .sort((left, right) => right.score - left.score || right.support_count - left.support_count || left.topic_id.localeCompare(right.topic_id))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 12)));
  if (!values.length) return [];
  const relatedIds = values.map((value) => value.topic_id);
  const relatedPlaceholders = relatedIds.map(() => "?").join(", ");
  const topics = new Map(db.query(`
    SELECT topic_id, kind, normalized_key, label, aliases_json, mention_count, document_frequency
    FROM chat_topics WHERE topic_id IN (${relatedPlaceholders})
  `).all(...relatedIds).map((row) => [row.topic_id, row]));
  return values.map((value, index) => {
    const topic = topics.get(value.topic_id);
    return {
      rank: index + 1,
      ...value,
      kind: topic?.kind ?? "topic",
      normalized_key: topic?.normalized_key ?? value.topic_id,
      label: topic?.label ?? value.topic_id,
      aliases: parseJson(topic?.aliases_json, []),
      mention_count: Number(topic?.mention_count ?? 0),
      document_frequency: Number(topic?.document_frequency ?? 0)
    };
  });
}

export function topicQueryPlan(db, query, {
  seedLimit = 6,
  relatedLimit = 12,
  messageLimit = 250,
  minSupport = 1,
  extractorFingerprint = BASIC_TOPIC_EXTRACTOR.fingerprint
} = {}) {
  const seeds = searchTopics(db, query, { limit: seedLimit });
  const related = relatedTopics(db, seeds, {
    limit: relatedLimit,
    minSupport,
    extractorFingerprint
  });
  const weights = new Map();
  for (const seed of seeds) {
    weights.set(seed.topic_id, {
      topic: seed,
      source: "direct",
      weight: seed.match_strength
    });
  }
  for (const topic of related) {
    const weight = topic.score * 0.65;
    const current = weights.get(topic.topic_id);
    if (!current || weight > current.weight) {
      weights.set(topic.topic_id, { topic, source: "associated", weight });
    }
  }
  if (!weights.size) return { query, seeds, related, candidates: [] };
  const topicIds = [...weights.keys()];
  const placeholders = topicIds.map(() => "?").join(", ");
  const rows = db.query(`
    SELECT m.topic_id, m.graph_id, m.graph_node_id, m.context_node_id, m.revision_oid,
           m.message_hid, m.conversation_hid, m.relation, m.weight, m.anchor_ids_json,
           m.support_node_ids_json, m.facets_json, t.kind, t.label, t.normalized_key
    FROM chat_topic_mentions m
    JOIN chat_topics t ON t.topic_id = m.topic_id
    WHERE m.extractor_fingerprint = ? AND m.topic_id IN (${placeholders})
    ORDER BY m.revision_oid, m.topic_id, m.weight DESC
  `).all(extractorFingerprint, ...topicIds);
  const byRevision = new Map();
  for (const row of rows) {
    const topicWeight = weights.get(row.topic_id);
    if (!topicWeight) continue;
    const contribution = topicWeight.weight * (Number(row.weight) || 0);
    const current = byRevision.get(row.revision_oid) ?? {
      revision_oid: row.revision_oid,
      message_hid: row.message_hid,
      conversation_hid: row.conversation_hid,
      raw_score: 0,
      direct_topics: new Map(),
      associated_topics: new Map(),
      facets: new Set(),
      graph_node_ids: new Set(),
      support_node_ids: new Set()
    };
    current.raw_score += contribution;
    const bucket = topicWeight.source === "direct" ? current.direct_topics : current.associated_topics;
    const previous = bucket.get(row.topic_id);
    if (!previous || contribution > previous.contribution) {
      bucket.set(row.topic_id, {
        topic_id: row.topic_id,
        label: row.label,
        kind: row.kind,
        relation: row.relation,
        contribution: Number(contribution.toFixed(6)),
        seed_topic_id: topicWeight.topic.seed_topic_id ?? null,
        association_score: topicWeight.topic.association_score ?? null,
        support_count: topicWeight.topic.support_count ?? null
      });
    }
    for (const facet of parseJson(row.facets_json, [])) current.facets.add(facet);
    current.graph_node_ids.add(row.graph_node_id);
    for (const nodeId of parseJson(row.support_node_ids_json, [])) current.support_node_ids.add(nodeId);
    byRevision.set(row.revision_oid, current);
  }
  const candidates = [...byRevision.values()].map((candidate) => ({
    revision_oid: candidate.revision_oid,
    message_hid: candidate.message_hid,
    conversation_hid: candidate.conversation_hid,
    score: Number((1 - Math.exp(-candidate.raw_score / 3)).toFixed(6)),
    direct_topics: [...candidate.direct_topics.values()].sort((left, right) => right.contribution - left.contribution || left.topic_id.localeCompare(right.topic_id)),
    associated_topics: [...candidate.associated_topics.values()].sort((left, right) => right.contribution - left.contribution || left.topic_id.localeCompare(right.topic_id)),
    facets: [...candidate.facets].sort(),
    graph_node_ids: [...candidate.graph_node_ids].sort(),
    support_node_ids: [...candidate.support_node_ids].sort()
  })).sort((left, right) => right.score - left.score || right.direct_topics.length - left.direct_topics.length || left.revision_oid.localeCompare(right.revision_oid))
    .slice(0, Math.max(1, Math.min(5000, Number(messageLimit) || 250)))
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
  return {
    $schema: CHAT_TOPIC_INDEX_SCHEMA,
    query: String(query ?? ""),
    extractor: BASIC_TOPIC_EXTRACTOR,
    seeds,
    related,
    candidates
  };
}
