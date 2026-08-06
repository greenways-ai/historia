import { canonicalJson, sha256 } from "./identity.js";
import { blobToVector, cosineSimilarity, vectorToBlob } from "./neural-classifier.js";
import { relatedTopics } from "./topic-index.js";

export const CHAT_NEURAL_INDEX_SCHEMA = "historia.chat.neural-index/v1";

function jsonText(value) {
  return canonicalJson(value, { newline: false });
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function batch(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function boundedScore(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(-1, Math.min(1, parsed)) : fallback;
}

function topicEmbeddingText(row) {
  const aliases = parseJson(row.aliases_json, []);
  return [...new Set([row.label, ...aliases].map((value) => String(value ?? "").normalize("NFKC").trim()).filter(Boolean))].join(". ");
}

function registerModel(db, descriptor) {
  db.query(`
    INSERT INTO chat_neural_models(
      model_fingerprint, runtime, runtime_module, model_id, model_revision,
      device, dtype, dimensions, descriptor_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_fingerprint) DO UPDATE SET
      descriptor_json = excluded.descriptor_json,
      dimensions = excluded.dimensions
  `).run(
    descriptor.fingerprint,
    descriptor.runtime,
    descriptor.runtime_module,
    descriptor.model_id,
    descriptor.model_revision,
    descriptor.device,
    descriptor.dtype,
    descriptor.dimensions,
    jsonText(descriptor)
  );
}

function clearModelProjection(db, fingerprint) {
  db.query("DELETE FROM chat_neural_topic_vectors WHERE model_fingerprint = ?").run(fingerprint);
  db.query("DELETE FROM chat_neural_message_vectors WHERE model_fingerprint = ?").run(fingerprint);
}

async function indexMessages(db, classifier, { limit, batchSize, threshold, maxLabels }) {
  const fingerprint = classifier.descriptor.fingerprint;
  const rows = db.query(`
    SELECT r.revision_oid, r.content_text
    FROM chat_message_revisions r
    WHERE trim(r.content_text) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM chat_neural_message_vectors v
        WHERE v.revision_oid = r.revision_oid AND v.model_fingerprint = ?
      )
    ORDER BY r.rowid
    LIMIT ?
  `).all(fingerprint, limit);
  const insert = db.query(`
    INSERT OR REPLACE INTO chat_neural_message_vectors(
      revision_oid, model_fingerprint, source_sha256, dimensions,
      vector_blob, labels_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  let indexed = 0;
  for (const rowsBatch of batch(rows, batchSize)) {
    const classifications = await classifier.classifyBatch(rowsBatch.map((row) => row.content_text), { threshold, maxLabels });
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < rowsBatch.length; index += 1) {
        const row = rowsBatch[index];
        const classification = classifications[index];
        insert.run(
          row.revision_oid,
          fingerprint,
          sha256({ revision_oid: row.revision_oid, content: row.content_text }),
          classification.vector.length,
          vectorToBlob(classification.vector),
          jsonText(classification.labels)
        );
        indexed += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return indexed;
}

async function indexTopics(db, classifier, { limit, batchSize }) {
  const fingerprint = classifier.descriptor.fingerprint;
  const rows = db.query(`
    SELECT t.topic_id, t.label, t.aliases_json, v.source_sha256 AS indexed_sha256
    FROM chat_topics t
    LEFT JOIN chat_neural_topic_vectors v
      ON v.topic_id = t.topic_id AND v.model_fingerprint = ?
    ORDER BY t.rowid
  `).all(fingerprint).map((row) => {
    const text = topicEmbeddingText(row);
    return { ...row, text, source_sha256: sha256({ topic_id: row.topic_id, text }) };
  }).filter((row) => row.source_sha256 !== row.indexed_sha256).slice(0, limit);
  const insert = db.query(`
    INSERT OR REPLACE INTO chat_neural_topic_vectors(
      topic_id, model_fingerprint, source_sha256, dimensions, vector_blob
    ) VALUES (?, ?, ?, ?, ?)
  `);
  let indexed = 0;
  for (const rowsBatch of batch(rows, batchSize)) {
    const vectors = await classifier.embed(rowsBatch.map((row) => row.text));
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < rowsBatch.length; index += 1) {
        const row = rowsBatch[index];
        const vector = vectors[index];
        insert.run(row.topic_id, fingerprint, row.source_sha256, vector.length, vectorToBlob(vector));
        indexed += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return indexed;
}

export async function indexNeuralProjection(db, classifier, {
  limit = 100_000,
  batchSize = 32,
  rebuild = false,
  threshold = 0.42,
  maxLabels = 4
} = {}) {
  if (!classifier?.descriptor?.fingerprint || typeof classifier.embed !== "function") {
    throw new Error("a neural classifier with a stable descriptor is required");
  }
  const resultLimit = boundedInteger(limit, 100_000, 1, 1_000_000);
  const selectedBatchSize = boundedInteger(batchSize, 32, 1, 512);
  registerModel(db, classifier.descriptor);
  if (rebuild) {
    db.exec("BEGIN IMMEDIATE");
    try {
      clearModelProjection(db, classifier.descriptor.fingerprint);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const startedAt = performance.now();
  const messages = await indexMessages(db, classifier, {
    limit: resultLimit,
    batchSize: selectedBatchSize,
    threshold,
    maxLabels
  });
  const topics = await indexTopics(db, classifier, {
    limit: resultLimit,
    batchSize: selectedBatchSize
  });
  return {
    model: classifier.descriptor,
    messages,
    topics,
    elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
    counts: neuralIndexCounts(db, classifier.descriptor.fingerprint)
  };
}

export function neuralIndexCounts(db, fingerprint = null) {
  const where = fingerprint ? " WHERE model_fingerprint = ?" : "";
  const parameters = fingerprint ? [fingerprint] : [];
  const count = (table) => Number(db.query(`SELECT COUNT(*) AS count FROM ${table}${where}`).get(...parameters).count);
  return {
    models: Number(db.query("SELECT COUNT(*) AS count FROM chat_neural_models").get().count),
    message_vectors: count("chat_neural_message_vectors"),
    topic_vectors: count("chat_neural_topic_vectors")
  };
}

export function neuralIndexStatus(db) {
  return db.query(`
    SELECT m.model_fingerprint, m.runtime, m.runtime_module, m.model_id, m.model_revision,
           m.device, m.dtype, m.dimensions, m.created_at,
           (SELECT COUNT(*) FROM chat_neural_message_vectors v WHERE v.model_fingerprint = m.model_fingerprint) AS message_vectors,
           (SELECT COUNT(*) FROM chat_neural_topic_vectors v WHERE v.model_fingerprint = m.model_fingerprint) AS topic_vectors
    FROM chat_neural_models m
    ORDER BY m.created_at DESC, m.model_fingerprint
  `).all().map((row) => ({
    ...row,
    dimensions: Number(row.dimensions),
    message_vectors: Number(row.message_vectors),
    topic_vectors: Number(row.topic_vectors)
  }));
}

function latestObservation(db, revisionOid, messageHid, { historical, sourceRefs }) {
  const column = historical ? "mo.revision_oid" : "mo.message_hid";
  const value = historical ? revisionOid : messageHid;
  const rows = db.query(`
    SELECT mo.source_ref, mo.commit_oid, mo.conversation_hid, mo.message_hid, mo.revision_oid,
           mo.node_id, mo.active, mo.active_position, mo.observed_at, mo.manifest_path, mo.message_path,
           co.title, cc.committed_at,
           (SELECT ci.archive_sha256 FROM chat_imports ci
              WHERE ci.source_ref = mo.source_ref AND ci.commit_oid = mo.commit_oid
              ORDER BY ci.receipt_path LIMIT 1) AS archive_sha256
    FROM chat_message_observations mo
    JOIN chat_conversation_observations co
      ON co.source_ref = mo.source_ref AND co.commit_oid = mo.commit_oid AND co.conversation_hid = mo.conversation_hid
    JOIN chat_commits cc
      ON cc.source_ref = mo.source_ref AND cc.commit_oid = mo.commit_oid
    WHERE ${column} = ?
    ORDER BY COALESCE(cc.committed_at, mo.observed_at, '') DESC, mo.rowid DESC
  `).all(value);
  return rows.find((row) => !sourceRefs || sourceRefs.has(row.source_ref)) ?? null;
}

function timeBoundary(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be a valid timestamp`);
  return timestamp;
}

function overlapScore(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function loadMessageVectorRows(db, revisionOids, fingerprint) {
  const result = new Map();
  for (const values of batch([...new Set(revisionOids)].filter(Boolean), 300)) {
    if (!values.length) continue;
    const placeholders = values.map(() => "?").join(", ");
    const rows = db.query(`
      SELECT v.revision_oid, v.dimensions, v.vector_blob, v.labels_json,
             r.message_hid, r.role, r.model, r.created_at, r.updated_at,
             r.content_text, r.token_estimate, i.conversation_hid
      FROM chat_neural_message_vectors v
      JOIN chat_message_revisions r ON r.revision_oid = v.revision_oid
      JOIN chat_message_identities i ON i.hid = r.message_hid
      WHERE v.model_fingerprint = ? AND v.revision_oid IN (${placeholders})
    `).all(fingerprint, ...values);
    for (const row of rows) result.set(row.revision_oid, row);
  }
  return result;
}

export async function searchNeuralTopics(db, query, classifier, {
  limit = 20,
  topicLimit = 8,
  relatedLimit = 12,
  minSimilarity = 0.28,
  minSupport = 1,
  sourceRef = null,
  role = null,
  since = null,
  until = null,
  historical = false
} = {}) {
  const value = String(query ?? "").trim();
  if (!value) return { $schema: CHAT_NEURAL_INDEX_SCHEMA, query: value, model: classifier.descriptor, labels: [], topics: [], related_topics: [], results: [] };
  const fingerprint = classifier.descriptor.fingerprint;
  const stored = db.query("SELECT 1 AS ok FROM chat_neural_models WHERE model_fingerprint = ?").get(fingerprint);
  if (!stored) throw new Error("the selected neural model has not been indexed; run `historia neural index` first");
  const [classification] = await classifier.classifyBatch([value]);
  const queryVector = classification.vector;
  const topicRows = db.query(`
    SELECT v.topic_id, v.dimensions, v.vector_blob,
           t.kind, t.normalized_key, t.label, t.aliases_json,
           t.mention_count, t.document_frequency
    FROM chat_neural_topic_vectors v
    JOIN chat_topics t ON t.topic_id = v.topic_id
    WHERE v.model_fingerprint = ?
  `).all(fingerprint);
  const selectedTopics = topicRows.map((row) => ({
    topic_id: row.topic_id,
    kind: row.kind,
    normalized_key: row.normalized_key,
    label: row.label,
    aliases: parseJson(row.aliases_json, []),
    mention_count: Number(row.mention_count),
    document_frequency: Number(row.document_frequency),
    similarity: cosineSimilarity(queryVector, blobToVector(row.vector_blob, row.dimensions))
  })).filter((row) => row.similarity >= boundedScore(minSimilarity, 0.28))
    .sort((left, right) => right.similarity - left.similarity || right.document_frequency - left.document_frequency || left.topic_id.localeCompare(right.topic_id))
    .slice(0, boundedInteger(topicLimit, 8, 1, 100))
    .map((row, index) => ({ rank: index + 1, match_strength: row.similarity, ...row }));
  const associated = relatedTopics(db, selectedTopics, {
    limit: boundedInteger(relatedLimit, 12, 1, 100),
    minSupport: boundedInteger(minSupport, 1, 1, 1000)
  });
  const topicWeights = new Map(selectedTopics.map((topic) => [topic.topic_id, { source: "neural", weight: topic.similarity, topic }]));
  for (const topic of associated) {
    const weight = topic.score * 0.55;
    const current = topicWeights.get(topic.topic_id);
    if (!current || weight > current.weight) topicWeights.set(topic.topic_id, { source: "associated", weight, topic });
  }
  if (!topicWeights.size) {
    return {
      $schema: CHAT_NEURAL_INDEX_SCHEMA,
      query: value,
      model: classifier.descriptor,
      labels: classification.labels,
      topics: selectedTopics,
      related_topics: associated,
      results: []
    };
  }

  const topicIds = [...topicWeights.keys()];
  const placeholders = topicIds.map(() => "?").join(", ");
  const mentions = db.query(`
    SELECT m.topic_id, m.revision_oid, m.message_hid, m.conversation_hid,
           m.relation, m.weight, m.facets_json, m.graph_id, m.graph_node_id,
           t.label, t.kind
    FROM chat_topic_mentions m
    JOIN chat_topics t ON t.topic_id = m.topic_id
    WHERE m.topic_id IN (${placeholders})
    ORDER BY m.revision_oid, m.topic_id, m.weight DESC
  `).all(...topicIds);
  const candidates = new Map();
  for (const mention of mentions) {
    const topicWeight = topicWeights.get(mention.topic_id);
    if (!topicWeight) continue;
    const current = candidates.get(mention.revision_oid) ?? {
      revision_oid: mention.revision_oid,
      message_hid: mention.message_hid,
      conversation_hid: mention.conversation_hid,
      topic_raw: 0,
      direct_topics: new Map(),
      associated_topics: new Map(),
      facets: new Set(),
      graph_ids: new Set(),
      graph_node_ids: new Set()
    };
    const contribution = topicWeight.weight * Number(mention.weight || 0);
    current.topic_raw += contribution;
    const target = topicWeight.source === "neural" ? current.direct_topics : current.associated_topics;
    const previous = target.get(mention.topic_id);
    if (!previous || contribution > previous.contribution) {
      target.set(mention.topic_id, {
        topic_id: mention.topic_id,
        label: mention.label,
        kind: mention.kind,
        relation: mention.relation,
        contribution: Number(contribution.toFixed(6)),
        similarity: topicWeight.topic.similarity ?? null,
        seed_topic_id: topicWeight.topic.seed_topic_id ?? null,
        association_score: topicWeight.topic.association_score ?? null
      });
    }
    for (const facet of parseJson(mention.facets_json, [])) current.facets.add(facet);
    current.graph_ids.add(mention.graph_id);
    current.graph_node_ids.add(mention.graph_node_id);
    candidates.set(mention.revision_oid, current);
  }

  const vectorRows = loadMessageVectorRows(db, [...candidates.keys()], fingerprint);
  const queryLabels = new Set(classification.labels.map((entry) => entry.label));
  const sources = sourceRef ? new Set(Array.isArray(sourceRef) ? sourceRef : [sourceRef]) : null;
  const roles = role ? new Set(Array.isArray(role) ? role : [role]) : null;
  const sinceValue = timeBoundary(since, "since");
  const untilValue = timeBoundary(until, "until");
  if (sinceValue !== null && untilValue !== null && sinceValue > untilValue) throw new Error("since must not be later than until");

  const results = [];
  for (const candidate of candidates.values()) {
    const row = vectorRows.get(candidate.revision_oid);
    if (!row || (roles && !roles.has(row.role))) continue;
    const created = row.created_at ? new Date(row.created_at).valueOf() : null;
    if (sinceValue !== null && created !== null && created < sinceValue) continue;
    if (untilValue !== null && created !== null && created > untilValue) continue;
    const observation = latestObservation(db, candidate.revision_oid, row.message_hid, { historical, sourceRefs: sources });
    if (!observation || (!historical && observation.revision_oid !== candidate.revision_oid)) continue;
    const messageVector = blobToVector(row.vector_blob, row.dimensions);
    const messageSimilarity = Math.max(0, cosineSimilarity(queryVector, messageVector));
    const messageLabels = parseJson(row.labels_json, []);
    const candidateLabels = new Set([...candidate.facets, ...messageLabels.map((entry) => entry.label)]);
    const labelOverlap = overlapScore(queryLabels, candidateLabels);
    const topicScore = 1 - Math.exp(-candidate.topic_raw / 3);
    const score = 0.58 * topicScore + 0.34 * messageSimilarity + 0.08 * labelOverlap;
    results.push({
      revision_oid: candidate.revision_oid,
      message_hid: row.message_hid,
      conversation_hid: observation.conversation_hid ?? row.conversation_hid,
      title: observation.title ?? "Untitled conversation",
      role: row.role,
      model: row.model,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content: row.content_text,
      token_estimate: row.token_estimate,
      score: Number(score.toFixed(6)),
      signals: {
        topic_score: Number(topicScore.toFixed(6)),
        message_similarity: Number(messageSimilarity.toFixed(6)),
        label_overlap: Number(labelOverlap.toFixed(6)),
        query_labels: classification.labels,
        message_labels: messageLabels,
        facets: [...candidate.facets].sort(),
        direct_topics: [...candidate.direct_topics.values()].sort((left, right) => right.contribution - left.contribution),
        associated_topics: [...candidate.associated_topics.values()].sort((left, right) => right.contribution - left.contribution),
        graph_ids: [...candidate.graph_ids].sort(),
        graph_node_ids: [...candidate.graph_node_ids].sort()
      },
      provenance: {
        source_ref: observation.source_ref,
        commit_oid: observation.commit_oid,
        archive_sha256: observation.archive_sha256,
        observed_at: observation.observed_at,
        committed_at: observation.committed_at,
        manifest_path: observation.manifest_path,
        message_path: observation.message_path,
        node_id: observation.node_id,
        active: Boolean(observation.active),
        active_position: observation.active_position
      }
    });
  }
  results.sort((left, right) => right.score - left.score || left.revision_oid.localeCompare(right.revision_oid));
  return {
    $schema: CHAT_NEURAL_INDEX_SCHEMA,
    query: value,
    model: classifier.descriptor,
    labels: classification.labels,
    topics: selectedTopics,
    related_topics: associated,
    results: results.slice(0, boundedInteger(limit, 20, 1, 500)).map((result, index) => ({ rank: index + 1, ...result }))
  };
}
