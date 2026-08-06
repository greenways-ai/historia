import { topicQueryPlan } from "./topic-index.js";

function ftsQuery(query) {
  const terms = String(query ?? "").normalize("NFKC").match(/[\p{L}\p{N}_./:@-]+/gu) ?? [];
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function timeBoundary(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be a valid timestamp`);
  return timestamp;
}

function allowedSources(sourceRef) {
  if (!sourceRef) return null;
  return new Set(Array.isArray(sourceRef) ? sourceRef : [sourceRef]);
}

function observations(db, whereColumn, value) {
  return db.query(`
    SELECT mo.source_ref, mo.commit_oid, mo.conversation_hid, mo.message_hid, mo.revision_oid,
           mo.node_id, mo.active, mo.active_position, mo.observed_at, mo.manifest_path, mo.message_path,
           co.title, co.created_at AS conversation_created_at, co.updated_at AS conversation_updated_at,
           cc.committed_at, cc.authored_at,
           (SELECT ci.archive_sha256 FROM chat_imports ci
              WHERE ci.source_ref = mo.source_ref AND ci.commit_oid = mo.commit_oid
              ORDER BY ci.receipt_path LIMIT 1) AS archive_sha256
    FROM chat_message_observations mo
    JOIN chat_conversation_observations co
      ON co.source_ref = mo.source_ref AND co.commit_oid = mo.commit_oid AND co.conversation_hid = mo.conversation_hid
    JOIN chat_commits cc
      ON cc.source_ref = mo.source_ref AND cc.commit_oid = mo.commit_oid
    WHERE mo.${whereColumn} = ?
    ORDER BY COALESCE(cc.committed_at, mo.observed_at, '') DESC, mo.rowid DESC
  `).all(value);
}

function latestObservationForRevision(db, revisionOid, sources = null) {
  return observations(db, "revision_oid", revisionOid).find((row) => !sources || sources.has(row.source_ref)) ?? null;
}

function latestObservationForMessage(db, messageHid, sources = null) {
  return observations(db, "message_hid", messageHid).find((row) => !sources || sources.has(row.source_ref)) ?? null;
}

function loadRevisionRows(db, revisionOids) {
  const result = new Map();
  const values = [...new Set(revisionOids)].filter(Boolean);
  for (let offset = 0; offset < values.length; offset += 400) {
    const chunk = values.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.query(`
      SELECT revision_oid, message_hid, role, model, created_at, updated_at,
             content_text, token_estimate
      FROM chat_message_revisions
      WHERE revision_oid IN (${placeholders})
    `).all(...chunk);
    for (const row of rows) result.set(row.revision_oid, row);
  }
  return result;
}

function fallbackSnippet(content) {
  const value = String(content ?? "").replace(/\s+/gu, " ").trim();
  if (!value) return "";
  return value.length <= 220 ? value : `${value.slice(0, 219)}…`;
}

function topicSummary(plan, candidate) {
  if (!candidate) return null;
  return {
    rank: candidate.rank,
    score: candidate.score,
    direct_topics: candidate.direct_topics,
    associated_topics: candidate.associated_topics,
    facets: candidate.facets,
    graph_node_ids: candidate.graph_node_ids,
    support_node_ids: candidate.support_node_ids,
    seed_topics: plan.seeds.map((topic) => ({
      topic_id: topic.topic_id,
      label: topic.label,
      kind: topic.kind,
      rank: topic.rank,
      match_strength: topic.match_strength
    })),
    related_topics: plan.related.map((topic) => ({
      topic_id: topic.topic_id,
      label: topic.label,
      kind: topic.kind,
      seed_topic_id: topic.seed_topic_id,
      association_score: topic.association_score,
      support_count: topic.support_count
    }))
  };
}

export function searchChatIndex(db, query, {
  limit = 20,
  sourceRef = null,
  role = null,
  since = null,
  until = null,
  historical = false,
  expandTopics = false,
  topicLimit = 12,
  topicSeedLimit = 6,
  topicMinSupport = 1
} = {}) {
  const match = ftsQuery(query);
  if (!match && !expandTopics) return [];
  const resultLimit = Math.max(1, Math.min(500, Number(limit) || 20));
  const candidateLimit = Math.min(5000, historical
    ? Math.max(resultLimit * 8, 80)
    : Math.max(resultLimit * 30, 300));
  const sources = allowedSources(sourceRef);
  const roles = role ? new Set(Array.isArray(role) ? role : [role]) : null;
  const sinceValue = timeBoundary(since, "since");
  const untilValue = timeBoundary(until, "until");
  if (sinceValue !== null && untilValue !== null && sinceValue > untilValue) throw new Error("since must not be later than until");

  const lexicalCandidates = match ? db.query(`
    SELECT f.revision_oid, f.message_hid, f.conversation_hid, f.title, f.role,
           bm25(chat_message_search) AS score,
           snippet(chat_message_search, 5, '[', ']', ' … ', 18) AS snippet,
           r.model, r.created_at, r.updated_at, r.content_text, r.token_estimate
    FROM chat_message_search f
    JOIN chat_message_revisions r ON r.revision_oid = f.revision_oid
    WHERE chat_message_search MATCH ?
    ORDER BY score, f.revision_oid
    LIMIT ?
  `).all(match, candidateLimit) : [];

  const topicPlan = expandTopics ? topicQueryPlan(db, query, {
    seedLimit: Math.max(1, Math.min(20, Number(topicSeedLimit) || 6)),
    relatedLimit: Math.max(1, Math.min(100, Number(topicLimit) || 12)),
    messageLimit: candidateLimit,
    minSupport: Math.max(1, Number(topicMinSupport) || 1)
  }) : { seeds: [], related: [], candidates: [] };

  const merged = new Map();
  for (const [index, candidate] of lexicalCandidates.entries()) {
    const current = merged.get(candidate.revision_oid) ?? {
      revision_oid: candidate.revision_oid,
      message_hid: candidate.message_hid,
      conversation_hid: candidate.conversation_hid,
      fused_score: 0,
      lexical: null,
      topic: null
    };
    current.lexical = { ...candidate, rank: index + 1 };
    current.fused_score += 1 / (60 + index + 1);
    merged.set(candidate.revision_oid, current);
  }
  for (const candidate of topicPlan.candidates) {
    const current = merged.get(candidate.revision_oid) ?? {
      revision_oid: candidate.revision_oid,
      message_hid: candidate.message_hid,
      conversation_hid: candidate.conversation_hid,
      fused_score: 0,
      lexical: null,
      topic: null
    };
    current.topic = candidate;
    current.fused_score += 0.85 / (60 + candidate.rank) + candidate.score * 0.01;
    merged.set(candidate.revision_oid, current);
  }

  const ordered = [...merged.values()].sort((left, right) => {
    if (expandTopics) {
      return right.fused_score - left.fused_score
        || (left.lexical?.score ?? Infinity) - (right.lexical?.score ?? Infinity)
        || (right.topic?.score ?? 0) - (left.topic?.score ?? 0)
        || left.revision_oid.localeCompare(right.revision_oid);
    }
    return (left.lexical?.rank ?? Infinity) - (right.lexical?.rank ?? Infinity)
      || left.revision_oid.localeCompare(right.revision_oid);
  });
  const revisions = loadRevisionRows(db, ordered.map((candidate) => candidate.revision_oid));

  const results = [];
  for (const candidate of ordered) {
    const revision = revisions.get(candidate.revision_oid);
    if (!revision) continue;
    if (roles && !roles.has(revision.role)) continue;
    const created = revision.created_at ? new Date(revision.created_at).valueOf() : null;
    if (sinceValue !== null && created !== null && created < sinceValue) continue;
    if (untilValue !== null && created !== null && created > untilValue) continue;
    const observation = historical
      ? latestObservationForRevision(db, candidate.revision_oid, sources)
      : latestObservationForMessage(db, revision.message_hid, sources);
    if (!observation || (!historical && observation.revision_oid !== candidate.revision_oid)) continue;
    const topic = topicSummary(topicPlan, candidate.topic);
    const lexical = candidate.lexical ? {
      rank: candidate.lexical.rank,
      bm25: candidate.lexical.score,
      snippet: candidate.lexical.snippet
    } : null;
    results.push({
      rank: results.length + 1,
      score: expandTopics ? -candidate.fused_score : candidate.lexical?.score,
      retrieval_score: expandTopics ? candidate.fused_score : null,
      snippet: candidate.lexical?.snippet ?? fallbackSnippet(revision.content_text),
      revision_oid: candidate.revision_oid,
      message_hid: revision.message_hid,
      conversation_hid: observation.conversation_hid ?? candidate.conversation_hid,
      title: observation.title ?? candidate.lexical?.title ?? "Untitled conversation",
      role: revision.role,
      model: revision.model,
      created_at: revision.created_at,
      updated_at: revision.updated_at,
      content: revision.content_text,
      token_estimate: revision.token_estimate,
      retrieval: {
        mode: expandTopics ? "lexical+topics" : "lexical",
        lexical,
        topics: topic
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
    if (results.length >= resultLimit) break;
  }
  return results;
}

export function listChatConversations(db, { limit = 100, sourceRef = null } = {}) {
  const conditions = [];
  const parameters = [];
  if (sourceRef) {
    conditions.push("co.source_ref = ?");
    parameters.push(sourceRef);
  }
  parameters.push(Math.max(1, Math.min(1000, Number(limit) || 100)));
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.query(`
    WITH ranked AS (
      SELECT co.source_ref, co.commit_oid, co.conversation_hid, co.title, co.created_at, co.updated_at,
             co.observed_at, co.node_count, co.edge_count, cc.committed_at,
             ROW_NUMBER() OVER (
               PARTITION BY co.conversation_hid
               ORDER BY COALESCE(cc.committed_at, co.observed_at, '') DESC, co.rowid DESC
             ) AS rank
      FROM chat_conversation_observations co
      JOIN chat_commits cc ON cc.source_ref = co.source_ref AND cc.commit_oid = co.commit_oid
      ${where}
    )
    SELECT source_ref, commit_oid, conversation_hid, title, created_at, updated_at,
           observed_at, committed_at, node_count, edge_count
    FROM ranked WHERE rank = 1
    ORDER BY COALESCE(updated_at, observed_at, committed_at, '') DESC, conversation_hid
    LIMIT ?
  `).all(...parameters);
}

export function loadConversationSnapshot(db, conversationHid, { sourceRef = null, commitOid = null } = {}) {
  const conditions = ["co.conversation_hid = ?"];
  const parameters = [conversationHid];
  if (sourceRef) {
    conditions.push("co.source_ref = ?");
    parameters.push(sourceRef);
  }
  if (commitOid) {
    conditions.push("co.commit_oid = ?");
    parameters.push(commitOid);
  }
  const observation = db.query(`
    SELECT co.*, cc.authored_at, cc.committed_at, cc.message AS commit_message,
           (SELECT ci.archive_sha256 FROM chat_imports ci
              WHERE ci.source_ref = co.source_ref AND ci.commit_oid = co.commit_oid
              ORDER BY ci.receipt_path LIMIT 1) AS archive_sha256
    FROM chat_conversation_observations co
    JOIN chat_commits cc ON cc.source_ref = co.source_ref AND cc.commit_oid = co.commit_oid
    WHERE ${conditions.join(" AND ")}
    ORDER BY COALESCE(cc.committed_at, co.observed_at, '') DESC, co.rowid DESC
    LIMIT 1
  `).get(...parameters);
  if (!observation) return null;

  const messages = db.query(`
    SELECT mo.message_hid, mo.revision_oid, mo.node_id, mo.active, mo.active_position,
           mo.observed_at, mo.message_path, r.role, r.author_json, r.model, r.created_at, r.updated_at,
           r.content_text, r.message_json, r.raw_oid, r.token_estimate
    FROM chat_message_observations mo
    JOIN chat_message_revisions r ON r.revision_oid = mo.revision_oid
    WHERE mo.source_ref = ? AND mo.commit_oid = ? AND mo.conversation_hid = ?
    ORDER BY CASE WHEN mo.active_position IS NULL THEN 1 ELSE 0 END,
             mo.active_position,
             COALESCE(r.created_at, ''),
             mo.message_hid
  `).all(observation.source_ref, observation.commit_oid, conversationHid).map((row) => ({
    ...row,
    active: Boolean(row.active),
    author: parseJson(row.author_json, {}),
    message: parseJson(row.message_json, {})
  }));

  const edges = db.query(`
    SELECT from_message_hid AS "from", to_message_hid AS "to", kind
    FROM chat_edges
    WHERE source_ref = ? AND commit_oid = ? AND conversation_hid = ?
    ORDER BY from_message_hid, to_message_hid, kind
  `).all(observation.source_ref, observation.commit_oid, conversationHid);

  return {
    conversation_hid: conversationHid,
    title: observation.title,
    created_at: observation.created_at,
    updated_at: observation.updated_at,
    observed_at: observation.observed_at,
    source_ref: observation.source_ref,
    commit_oid: observation.commit_oid,
    committed_at: observation.committed_at,
    archive_sha256: observation.archive_sha256,
    manifest_path: observation.manifest_path,
    active_paths: parseJson(observation.active_path_json, []),
    manifest: parseJson(observation.manifest_json, {}),
    messages,
    edges
  };
}

export function chatIndexHeads(db) {
  return db.query(`
    SELECT source_ref, provider, source_key, completeness, head_commit_oid, last_indexed_at
    FROM chat_sources ORDER BY source_ref
  `).all();
}
