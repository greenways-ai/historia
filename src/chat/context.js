import { chatIndexHeads, loadConversationSnapshot, searchChatIndex } from "./search.js";
import { messageArchivePaths } from "./archive-layout.js";
import { displayRole, estimateTokens, messageMarkdown, truncateToEstimatedTokens } from "./text.js";

function snapshotKey(hit) {
  return `${hit.provenance.source_ref}\0${hit.provenance.commit_oid}\0${hit.conversation_hid}`;
}

function chronological(left, right) {
  const leftActive = left.message.active_position;
  const rightActive = right.message.active_position;
  if (leftActive !== null && leftActive !== undefined && rightActive !== null && rightActive !== undefined) return leftActive - rightActive;
  if (leftActive !== null && leftActive !== undefined) return -1;
  if (rightActive !== null && rightActive !== undefined) return 1;
  return String(left.message.created_at ?? "").localeCompare(String(right.message.created_at ?? ""))
    || left.message.message_hid.localeCompare(right.message.message_hid);
}

function compactRetrieval(hit) {
  const retrieval = hit?.retrieval;
  if (!retrieval) return null;
  return {
    mode: retrieval.mode,
    lexical_rank: retrieval.lexical?.rank ?? null,
    direct_topics: (retrieval.topics?.direct_topics ?? []).slice(0, 8).map((topic) => ({
      topic_id: topic.topic_id,
      label: topic.label,
      kind: topic.kind,
      contribution: topic.contribution
    })),
    associated_topics: (retrieval.topics?.associated_topics ?? []).slice(0, 8).map((topic) => ({
      topic_id: topic.topic_id,
      label: topic.label,
      kind: topic.kind,
      contribution: topic.contribution,
      seed_topic_id: topic.seed_topic_id,
      association_score: topic.association_score,
      support_count: topic.support_count
    })),
    facets: retrieval.topics?.facets ?? [],
    graph_node_ids: (retrieval.topics?.graph_node_ids ?? []).slice(0, 16)
  };
}

function selectedMessages(snapshot, hits, { radius, includeBranches }) {
  const messagesByHid = new Map(snapshot.messages.map((message) => [message.message_hid, message]));
  const activeMessages = snapshot.messages.filter((message) => message.active_position !== null && message.active_position !== undefined)
    .sort((left, right) => left.active_position - right.active_position);
  const activeIndex = new Map(activeMessages.map((message, index) => [message.message_hid, index]));
  const priorities = new Map();
  const retrievals = new Map();
  const mark = (messageHid, priority, retrieval = null) => {
    if (!messagesByHid.has(messageHid)) return;
    priorities.set(messageHid, Math.min(priorities.get(messageHid) ?? Infinity, priority));
    if (retrieval) {
      const values = retrievals.get(messageHid) ?? [];
      const key = JSON.stringify(retrieval);
      if (!values.some((value) => JSON.stringify(value) === key)) values.push(retrieval);
      retrievals.set(messageHid, values);
    }
  };

  for (const hit of hits) {
    const hitMessage = snapshot.messages.find((message) => message.revision_oid === hit.revision_oid)
      ?? messagesByHid.get(hit.message_hid);
    if (!hitMessage) continue;
    mark(hitMessage.message_hid, 0, compactRetrieval(hit));
    const index = activeIndex.get(hitMessage.message_hid);
    if (index !== undefined) {
      for (let offset = -radius; offset <= radius; offset += 1) {
        const neighbor = activeMessages[index + offset];
        if (neighbor) mark(neighbor.message_hid, Math.abs(offset));
      }
    } else {
      for (const parent of hitMessage.message?.parents ?? []) mark(parent, 1);
      for (const edge of snapshot.edges) {
        if (edge.from === hitMessage.message_hid) mark(edge.to, 1);
        if (edge.to === hitMessage.message_hid) mark(edge.from, 1);
      }
    }
  }

  if (includeBranches) {
    for (const [messageHid, priority] of [...priorities]) {
      for (const edge of snapshot.edges) {
        if (edge.from === messageHid) mark(edge.to, priority + 1);
        if (edge.to === messageHid) mark(edge.from, priority + 1);
      }
    }
  }

  return [...priorities].map(([messageHid, priority]) => ({
    message: messagesByHid.get(messageHid),
    priority,
    retrieval: retrievals.get(messageHid) ?? []
  })).sort((left, right) => left.priority - right.priority || chronological(left, right));
}

function messageCost(message, content, retrieval = []) {
  return estimateTokens(`${message.role}\n${message.created_at ?? ""}\n${JSON.stringify(retrieval)}\n${content}`) + 18;
}

export function buildChatContext(db, query, {
  budget = 12_000,
  maxConversations = 8,
  radius = 2,
  includeBranches = false,
  sourceRef = null,
  role = null,
  since = null,
  until = null,
  historical = false,
  expandTopics = false,
  topicLimit = 12,
  topicSeedLimit = 6,
  topicMinSupport = 1,
  generatedAt = new Date().toISOString()
} = {}) {
  const tokenBudget = Math.max(128, Math.min(2_000_000, Number(budget) || 12_000));
  const conversationLimit = Math.max(1, Math.min(50, Number(maxConversations) || 8));
  const windowRadius = Math.max(0, Math.min(20, Number(radius) || 0));
  const hits = searchChatIndex(db, query, {
    limit: Math.max(60, conversationLimit * 12),
    sourceRef,
    role,
    since,
    until,
    historical,
    expandTopics,
    topicLimit,
    topicSeedLimit,
    topicMinSupport
  });

  const groups = new Map();
  for (const hit of hits) {
    const key = snapshotKey(hit);
    const group = groups.get(key) ?? { key, hits: [], bestRank: hit.rank, bestScore: hit.score };
    group.hits.push(hit);
    group.bestRank = Math.min(group.bestRank, hit.rank);
    group.bestScore = Math.min(group.bestScore, hit.score);
    groups.set(key, group);
  }

  const orderedGroups = [...groups.values()]
    .sort((left, right) => left.bestRank - right.bestRank || left.bestScore - right.bestScore || left.key.localeCompare(right.key))
    .slice(0, conversationLimit);

  const bundle = {
    $schema: "historia.chat.context-bundle/v1",
    generated_at: generatedAt,
    query: String(query ?? ""),
    budget: {
      requested_tokens: tokenBudget,
      estimated_tokens: 0,
      estimator: "utf8-bytes-divided-by-four"
    },
    filters: {
      source_ref: sourceRef ?? null,
      role: role ?? null,
      since: since ?? null,
      until: until ?? null,
      historical: Boolean(historical),
      include_branches: Boolean(includeBranches),
      radius: windowRadius,
      expand_topics: Boolean(expandTopics),
      topic_limit: Number(topicLimit) || 12,
      topic_seed_limit: Number(topicSeedLimit) || 6,
      topic_min_support: Number(topicMinSupport) || 1
    },
    vault_heads: chatIndexHeads(db),
    matches: {
      search_results: hits.length,
      conversation_snapshots: orderedGroups.length,
      included_messages: 0
    },
    conversations: [],
    citations: []
  };

  const baseCost = estimateTokens(JSON.stringify({
    schema: bundle.$schema,
    generated_at: bundle.generated_at,
    query: bundle.query,
    vault_heads: bundle.vault_heads
  })) + 80;
  let used = Math.min(tokenBudget, baseCost);
  let citationNumber = 1;
  const seenRevisions = new Set();

  for (const group of orderedGroups) {
    const firstHit = group.hits[0];
    const snapshot = loadConversationSnapshot(db, firstHit.conversation_hid, {
      sourceRef: firstHit.provenance.source_ref,
      commitOid: firstHit.provenance.commit_oid
    });
    if (!snapshot) continue;

    const candidates = selectedMessages(snapshot, group.hits, { radius: windowRadius, includeBranches });
    const chosen = [];
    for (const candidate of candidates) {
      const message = candidate.message;
      if (!message || seenRevisions.has(message.revision_oid)) continue;
      const markdown = messageMarkdown(message.message) || message.content_text || "[empty message]";
      const remaining = tokenBudget - used;
      const fullCost = messageCost(message, markdown, candidate.retrieval);
      if (fullCost <= remaining) {
        chosen.push({ ...candidate, content: markdown, truncated: false, cost: fullCost });
        used += fullCost;
        seenRevisions.add(message.revision_oid);
        continue;
      }
      const overhead = messageCost(message, "", candidate.retrieval);
      const contentBudget = remaining - overhead;
      if (contentBudget >= 32 && candidate.priority === 0) {
        const truncated = truncateToEstimatedTokens(markdown, contentBudget);
        const cost = messageCost(message, truncated.text);
        chosen.push({ ...candidate, content: truncated.text, truncated: true, cost });
        used += Math.min(remaining, cost);
        seenRevisions.add(message.revision_oid);
      }
      if (used >= tokenBudget) break;
    }
    if (!chosen.length) continue;

    chosen.sort(chronological);
    const conversation = {
      conversation_hid: snapshot.conversation_hid,
      title: snapshot.title,
      source_ref: snapshot.source_ref,
      commit_oid: snapshot.commit_oid,
      archive_sha256: snapshot.archive_sha256,
      observed_at: snapshot.observed_at,
      committed_at: snapshot.committed_at,
      manifest_path: snapshot.manifest_path,
      messages: []
    };
    for (const item of chosen) {
      const citation = `H${citationNumber++}`;
      const message = item.message;
      conversation.messages.push({
        citation,
        message_hid: message.message_hid,
        revision_oid: message.revision_oid,
        role: message.role,
        author: message.author,
        model: message.model,
        created_at: message.created_at,
        active: message.active,
        active_position: message.active_position,
        retrieval: item.retrieval,
        content: item.content,
        truncated: item.truncated
      });
      bundle.citations.push({
        citation,
        conversation_hid: snapshot.conversation_hid,
        message_hid: message.message_hid,
        revision_oid: message.revision_oid,
        source_ref: snapshot.source_ref,
        commit_oid: snapshot.commit_oid,
        archive_sha256: snapshot.archive_sha256,
        manifest_path: snapshot.manifest_path,
        message_path: message.message_path ?? messageArchivePaths(message.revision_oid, message.raw_oid ?? message.revision_oid).normalized,
        observed_at: snapshot.observed_at
      });
    }
    bundle.conversations.push(conversation);
    if (used >= tokenBudget) break;
  }

  bundle.matches.included_messages = bundle.citations.length;
  bundle.matches.conversation_snapshots = bundle.conversations.length;
  bundle.budget.estimated_tokens = Math.min(tokenBudget, used);
  return bundle;
}

function topicRetrievalLine(message) {
  const retrieval = (message.retrieval ?? []).find((item) => item.direct_topics?.length || item.associated_topics?.length);
  if (!retrieval) return null;
  const direct = retrieval.direct_topics.map((topic) => topic.label);
  const associated = retrieval.associated_topics.map((topic) => topic.label);
  const parts = [];
  if (direct.length) parts.push(`direct topics: ${direct.join(", ")}`);
  if (associated.length) parts.push(`related topics: ${associated.join(", ")}`);
  if (retrieval.facets?.length) parts.push(`graph facets: ${retrieval.facets.join(", ")}`);
  return parts.length ? `_Retrieval: ${parts.join(" · ")}_` : null;
}

export function formatChatContextMarkdown(bundle) {
  const lines = [
    "# Historia Context Bundle",
    "",
    `- Generated: ${bundle.generated_at}`,
    `- Query: ${bundle.query}`,
    `- Messages: ${bundle.matches.included_messages}`,
    `- Conversations: ${bundle.matches.conversation_snapshots}`,
    `- Estimated tokens: ${bundle.budget.estimated_tokens} / ${bundle.budget.requested_tokens}`,
    ""
  ];

  if (!bundle.conversations.length) {
    lines.push("No matching conversation context was found.", "");
  }

  for (const conversation of bundle.conversations) {
    lines.push(`## ${conversation.title}`, "");
    lines.push(`_Source ref: \`${conversation.source_ref}\` · archive commit: \`${conversation.commit_oid}\`_`, "");
    for (const message of conversation.messages) {
      const timestamp = message.created_at ? ` · ${message.created_at}` : "";
      lines.push(`### [${message.citation}] ${displayRole(message.role)}${timestamp}`, "");
      const retrievalLine = topicRetrievalLine(message);
      if (retrievalLine) lines.push(retrievalLine, "");
      lines.push(message.content, "");
    }
  }

  lines.push("## Provenance", "");
  for (const citation of bundle.citations) {
    lines.push(`- [${citation.citation}] message \`${citation.message_hid}\`; revision \`${citation.revision_oid}\`; commit \`${citation.commit_oid}\`; ref \`${citation.source_ref}\`; object path \`${citation.message_path}\`.`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
