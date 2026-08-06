import { canonicalJson, sha256 } from "./identity.js";

export const TEXT_GRAPH_SCHEMA = "historia.text.graph/v1";
export const TEXT_PROJECTION_SCHEMA = "historia.text.projection/v1";

const ANALYZER_NAME = "historia-basic-text-graph";
const ANALYZER_VERSION = "0.1.0";
const RULESET_VERSION = "2026-08-06.1";
const TEXTUAL_BLOCK_TYPES = new Set(["text", "citation", "provider"]);
const LAYER_ORDER = new Map(["source", "reference", "semantic", "discourse", "work", "lineage", "provenance"].map((value, index) => [value, index]));
const SOURCE_KIND_ORDER = new Map(["message", "block", "sentence"].map((value, index) => [value, index]));

export const DEFAULT_TEXT_ENTITY_ALIASES = Object.freeze([
  {
    canonical_key: "project:greenways-ai/greenways",
    kind: "project",
    label: "Greenways",
    aliases: ["Greenways", "Greenways.ai"]
  },
  {
    canonical_key: "project:hara-lang/hara",
    kind: "project",
    label: "Hara",
    aliases: ["Hara", "Hara language"]
  },
  {
    canonical_key: "project:greenways-ai/hestia",
    kind: "project",
    label: "Hestia",
    aliases: ["Hestia"]
  },
  {
    canonical_key: "project:greenways-ai/historia",
    kind: "project",
    label: "Historia",
    aliases: ["Historia", "Historia Collect"]
  },
  {
    canonical_key: "project:greenways-ai/hodos",
    kind: "project",
    label: "Hodos",
    aliases: ["Hodos"]
  },
  {
    canonical_key: "project:greenways-ai/hoplite",
    kind: "project",
    label: "Hoplite",
    aliases: ["Hoplite"]
  },
  {
    canonical_key: "project:greenways-ai/ignatius",
    kind: "project",
    label: "Ignatius",
    aliases: ["Ignatius"]
  }
]);

const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "because",
  "been", "before", "being", "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing", "for",
  "from", "get", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "just", "let", "like", "may", "me", "might", "more", "most", "must", "my", "need", "no",
  "not", "of", "on", "or", "our", "ours", "out", "over", "please", "should", "so", "some", "such", "than", "that",
  "the", "their", "theirs", "them", "then", "there", "these", "they", "this", "those", "to", "too", "under", "up", "us",
  "use", "using", "very", "want", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your", "yours"
]);

const SPEECH_ACT_RULES = Object.freeze([
  {
    kind: "request",
    layer: "work",
    confidence: 0.98,
    patterns: [
      /\b(?:i['’]?d|i would) like\b/iu,
      /\bplease\b/iu,
      /\b(?:can|could|would) you\b/iu,
      /\blet['’]?s\b/iu,
      /\bkeep going\b/iu,
      /\bcontinue\b/iu
    ]
  },
  {
    kind: "constraint",
    layer: "work",
    confidence: 0.96,
    patterns: [
      /\bmust(?: not)?\b/iu,
      /\b(?:do not|don['’]?t|cannot|can['’]?t|should not|shouldn['’]?t)\b/iu,
      /\b(?:required|requirement|required to)\b/iu,
      /\b(?:limited|restricted) to\b/iu,
      /\bonly\b/iu
    ]
  },
  {
    kind: "rejection",
    layer: "discourse",
    confidence: 0.97,
    patterns: [
      /\b(?:i do not|i don['’]?t) want\b/iu,
      /\b(?:remove|get rid of|reject|drop)\b/iu,
      /\b(?:does not|doesn['’]?t|is not|isn['’]?t) work\b/iu,
      /^(?:no|nope)\b/iu,
      /\brather than\b/iu
    ]
  },
  {
    kind: "acceptance",
    layer: "discourse",
    confidence: 0.94,
    patterns: [
      /^(?:yes|yep|yeah|great|correct|exactly)\b/iu,
      /\b(?:that['’]?s right|looks good|go with|approved)\b/iu
    ]
  },
  {
    kind: "proposal",
    layer: "discourse",
    confidence: 0.88,
    patterns: [
      /\bwe should\b/iu,
      /\b(?:could|might) be\b/iu,
      /\bi propose\b/iu,
      /\blet['’]?s\b/iu,
      /\bhow about\b/iu
    ]
  },
  {
    kind: "decision",
    layer: "work",
    confidence: 0.93,
    patterns: [
      /\b(?:we decided|the decision is|we will use|we['’]?ll use|go with)\b/iu,
      /\buse .+ instead\b/iu,
      /\bshould be (?:the|our|a)\b/iu
    ]
  },
  {
    kind: "status",
    layer: "work",
    confidence: 0.9,
    patterns: [
      /\b(?:merged|deployed|implemented|fixed|completed|done|working|broken|failing|failed)\b/iu
    ]
  },
  {
    kind: "rationale",
    layer: "discourse",
    confidence: 0.86,
    patterns: [
      /^(?:because|since)\b/iu,
      /\bthe reason (?:is|was)\b/iu,
      /\bso that\b/iu
    ]
  },
  {
    kind: "correction",
    layer: "discourse",
    confidence: 0.86,
    patterns: [
      /^(?:actually|rather|instead)\b/iu,
      /\bnot .+ but\b/iu,
      /\bi mean\b/iu
    ]
  }
]);

function normalizedAliases(aliases) {
  return (Array.isArray(aliases) ? aliases : [])
    .map((entry) => ({
      canonical_key: String(entry.canonical_key),
      kind: String(entry.kind ?? "entity"),
      label: String(entry.label ?? entry.canonical_key),
      aliases: [...new Set((entry.aliases ?? [entry.label]).map((value) => String(value).normalize("NFKC")).filter(Boolean))]
        .sort((left, right) => right.length - left.length || left.localeCompare(right))
    }))
    .sort((left, right) => left.canonical_key.localeCompare(right.canonical_key));
}

export function textGraphAnalyzerDescriptor({ aliases = DEFAULT_TEXT_ENTITY_ALIASES } = {}) {
  const aliasRegistry = normalizedAliases(aliases);
  return {
    name: ANALYZER_NAME,
    version: ANALYZER_VERSION,
    fingerprint: sha256({
      name: ANALYZER_NAME,
      version: ANALYZER_VERSION,
      ruleset: RULESET_VERSION,
      aliases: aliasRegistry
    })
  };
}

export const BASIC_TEXT_GRAPH_ANALYZER = Object.freeze(textGraphAnalyzerDescriptor());

function isWordCharacter(character) {
  return Boolean(character && /[\p{L}\p{N}_-]/u.test(character));
}

function isBoundary(text, start, end) {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return !isWordCharacter(before) && !isWordCharacter(after);
}

function trimCharacterRange(text, start, end) {
  let left = start;
  let right = end;
  while (left < right) {
    const codePoint = text.codePointAt(left);
    const width = codePoint > 0xffff ? 2 : 1;
    if (!/\s/u.test(String.fromCodePoint(codePoint))) break;
    left += width;
  }
  while (right > left) {
    const codePoint = text.codePointAt(right - 1);
    if (codePoint >= 0xdc00 && codePoint <= 0xdfff && right >= 2) {
      const pair = text.slice(right - 2, right);
      if (/\s/u.test(pair)) right -= 2;
      else break;
    } else if (/\s/u.test(text[right - 1])) right -= 1;
    else break;
  }
  return [left, right];
}

function sentenceCharacterRanges(text) {
  const ranges = [];
  let start = 0;
  let index = 0;
  const closeCharacters = new Set(["\"", "'", "’", "”", ")", "]", "}", "」", "』", "】", "》"]);

  const push = (end) => {
    const [left, right] = trimCharacterRange(text, start, end);
    if (right > left) ranges.push({ start: left, end: right });
  };

  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const width = codePoint > 0xffff ? 2 : 1;
    if (character === "\r" || character === "\n") {
      push(index);
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      index += 1;
      start = index;
      continue;
    }
    if ([".", "?", "!", "。", "？", "！"].includes(character)) {
      let end = index + width;
      while (end < text.length && closeCharacters.has(text[end])) end += 1;
      const closesWithoutWhitespace = ["。", "？", "！"].includes(character);
      if (closesWithoutWhitespace || end >= text.length || /\s/u.test(text[end])) {
        push(end);
        start = end;
      }
      index = end;
      continue;
    }
    index += width;
  }
  push(text.length);
  return ranges;
}

function byteOffset(text, characterOffset) {
  return Buffer.byteLength(text.slice(0, characterOffset), "utf8");
}

function normalizedWords(text) {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
}

function keywords(text) {
  const seen = new Set();
  const result = [];
  for (const word of normalizedWords(text)) {
    if (word.length < 2 || STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length >= 24) break;
  }
  return result;
}

function modality(text) {
  const value = text.normalize("NFKC").toLowerCase();
  if (/\b(?:must|required|needs? to|has to|have to)\b/u.test(value)) return "required";
  if (/\b(?:i['’]?d like|i would like|want to|we should|should be)\b/u.test(value)) return "desired";
  if (/\b(?:could|might|may|possibly|perhaps)\b/u.test(value)) return "possible";
  if (/\b(?:will|we['’]?ll|going to)\b/u.test(value)) return "future";
  return "asserted";
}

function polarity(text) {
  return /\b(?:not|no|never|cannot|can['’]?t|do not|don['’]?t|does not|doesn['’]?t|is not|isn['’]?t|must not)\b/iu.test(text)
    ? "negative"
    : "positive";
}

function classifySpeechActs(text) {
  const acts = [];
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) return acts;
  const question = normalized.endsWith("?") || normalized.endsWith("？")
    || /^(?:who|what|when|where|why|how|can|could|would|should|is|are|do|does|did)\b/iu.test(normalized);
  if (question) acts.push({ kind: "question", layer: "discourse", confidence: 0.99, rule: "question-form" });
  for (const rule of SPEECH_ACT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      acts.push({ kind: rule.kind, layer: rule.layer, confidence: rule.confidence, rule: `${rule.kind}-phrases` });
    }
  }
  const byKind = new Map();
  for (const act of acts) {
    const current = byKind.get(act.kind);
    if (!current || act.confidence > current.confidence) byKind.set(act.kind, act);
  }
  return [...byKind.values()].sort((left, right) => left.layer.localeCompare(right.layer) || left.kind.localeCompare(right.kind));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function aliasCandidates(text, aliases) {
  const candidates = [];
  for (const entry of aliases) {
    for (const alias of entry.aliases) {
      const pattern = new RegExp(escapeRegExp(alias), "giu");
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (isBoundary(text, start, end)) candidates.push({ start, end, entry, alias: match[0] });
      }
    }
  }
  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start) || left.entry.canonical_key.localeCompare(right.entry.canonical_key));
  const accepted = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some((item) => candidate.start < item.end && item.start < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }
  return accepted;
}

function urlCandidates(text) {
  const values = [];
  const pattern = /https?:\/\/[^\s<>{}\[\]"']+/giu;
  for (const match of text.matchAll(pattern)) {
    let value = match[0];
    while (/[.,;:!?)]$/u.test(value)) value = value.slice(0, -1);
    if (!value) continue;
    values.push({
      start: match.index,
      end: match.index + value.length,
      kind: "url",
      label: value,
      canonical_key: `url:${value}`,
      properties: { url: value }
    });
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() === "github.com") {
        const [owner, repository] = url.pathname.split("/").filter(Boolean);
        if (owner && repository) {
          const fullName = `${owner}/${repository.replace(/\.git$/u, "")}`;
          values.push({
            start: match.index,
            end: match.index + value.length,
            kind: "repository",
            label: fullName,
            canonical_key: `repository:${fullName.toLowerCase()}`,
            properties: { repository: fullName, url: value }
          });
        }
      }
    } catch {
      // The URL node remains useful even when URL parsing rejects provider text.
    }
  }
  return values;
}

function packageCandidates(text) {
  const values = [];
  const pattern = /(^|[^\p{L}\p{N}_])(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/giu;
  for (const match of text.matchAll(pattern)) {
    const value = match[2];
    const start = match.index + match[1].length;
    values.push({
      start,
      end: start + value.length,
      kind: "package",
      label: value,
      canonical_key: `package:${value.toLowerCase()}`,
      properties: { package: value }
    });
  }
  return values;
}

function repositoryCandidates(text) {
  const values = [];
  const pattern = /(^|[^\p{L}\p{N}_.-])((?:greenways-ai|hara-lang|openai|huggingface)\/[A-Za-z0-9_.-]+)/giu;
  for (const match of text.matchAll(pattern)) {
    const value = match[2];
    const start = match.index + match[1].length;
    values.push({
      start,
      end: start + value.length,
      kind: "repository",
      label: value,
      canonical_key: `repository:${value.toLowerCase()}`,
      properties: { repository: value }
    });
  }
  return values;
}

function pathCandidates(text) {
  const values = [];
  const pattern = /(^|[\s`'"(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12})/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[2];
    const start = match.index + match[1].length;
    values.push({
      start,
      end: start + value.length,
      kind: "path",
      label: value,
      canonical_key: `path:${value}`,
      properties: { path: value }
    });
  }
  return values;
}

function graphIdFor(revisionOid, analyzerFingerprint) {
  return `historia:text-graph:${sha256({ revision_oid: revisionOid, analyzer_fingerprint: analyzerFingerprint })}`;
}

function anchorIdFor(anchor) {
  return `historia:text-anchor:${sha256(anchor)}`;
}

function nodeIdFor(graphId, identity) {
  return `historia:text-node:${sha256({ graph_id: graphId, identity })}`;
}

function edgeIdFor(graphId, edge) {
  return `historia:text-edge:${sha256({ graph_id: graphId, ...edge })}`;
}

function sourceHashFor(anchorIds, anchors) {
  const values = anchorIds.map((id) => anchors.get(id)?.exact ?? "");
  return sha256(values.join("\0"));
}

function graphBuilder({ graphId, revisionOid }) {
  const anchors = new Map();
  const nodes = new Map();
  const edges = new Map();

  const addAnchor = ({ blockIndex, startByte, endByte, exact, role = "evidence" }) => {
    const record = {
      revision_oid: revisionOid,
      block_index: blockIndex,
      start_byte: startByte,
      end_byte: endByte,
      exact_sha256: sha256(exact),
      exact,
      role
    };
    const anchorId = anchorIdFor(record);
    anchors.set(anchorId, { anchor_id: anchorId, ...record });
    return anchorId;
  };

  const addNode = ({ identity, layer, kind, label, anchorIds = [], properties = {}, structure = null }) => {
    const nodeId = nodeIdFor(graphId, identity);
    const existing = nodes.get(nodeId);
    const mergedAnchorIds = [...new Set([...(existing?.anchor_ids ?? []), ...anchorIds])].sort();
    const structuralValue = structure ?? { layer, kind, properties };
    const node = {
      node_id: nodeId,
      layer,
      kind,
      label: String(label ?? kind),
      anchor_ids: mergedAnchorIds,
      source_hash: sourceHashFor(mergedAnchorIds, anchors),
      structural_hash: sha256(structuralValue),
      properties
    };
    nodes.set(nodeId, node);
    return nodeId;
  };

  const addEdge = ({ from, to, kind, layer, confidence = 1, resolution = "parsed", anchorIds = [], properties = {} }) => {
    const core = { from, to, kind, layer, confidence, resolution, anchor_ids: [...new Set(anchorIds)].sort(), properties };
    const edgeId = edgeIdFor(graphId, core);
    edges.set(edgeId, { edge_id: edgeId, ...core });
    return edgeId;
  };

  return { anchors, nodes, edges, addAnchor, addNode, addEdge };
}

function blockText(block) {
  return typeof block?.text === "string" ? block.text : "";
}

function compactLabel(text, maximum = 160) {
  const value = text.replace(/\s+/gu, " ").trim();
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

export function analyzeMessageTextGraph(message, {
  revisionOid = message?.revision_oid ?? null,
  aliases = DEFAULT_TEXT_ENTITY_ALIASES
} = {}) {
  if (!message || typeof message !== "object") throw new Error("a normalized Historia message is required");
  const normalizedRevisionOid = String(revisionOid ?? sha256(canonicalJson(message, { newline: false })));
  const aliasRegistry = normalizedAliases(aliases);
  const analyzer = textGraphAnalyzerDescriptor({ aliases: aliasRegistry });
  const graphId = graphIdFor(normalizedRevisionOid, analyzer.fingerprint);
  const builder = graphBuilder({ graphId, revisionOid: normalizedRevisionOid });
  const diagnostics = [];
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];

  const sourceText = blocks.map((block) => blockText(block)).join("\0");
  const documentNodeId = builder.addNode({
    identity: { kind: "message", revision_oid: normalizedRevisionOid },
    layer: "source",
    kind: "message",
    label: `${message.role ?? "unknown"} message`,
    properties: {
      role: message.role ?? "unknown",
      author_kind: message.author?.kind ?? message.role ?? "unknown",
      message_hid: message.hid ?? null,
      block_count: blocks.length
    },
    structure: { role: message.role ?? "unknown", block_types: blocks.map((block) => block?.type ?? "provider") }
  });

  for (const [blockIndex, block] of blocks.entries()) {
    const type = String(block?.type ?? "provider");
    const text = blockText(block);
    const blockAnchorIds = [];
    if (text) {
      blockAnchorIds.push(builder.addAnchor({
        blockIndex,
        startByte: 0,
        endByte: Buffer.byteLength(text, "utf8"),
        exact: text,
        role: "block"
      }));
    }
    const blockNodeId = builder.addNode({
      identity: { kind: "block", block_index: blockIndex, block_type: type },
      layer: "source",
      kind: "block",
      label: `${type} block ${blockIndex + 1}`,
      anchorIds: blockAnchorIds,
      properties: {
        block_index: blockIndex,
        block_type: type,
        language: block?.language ?? null,
        asset_pointer: block?.asset_pointer ?? null
      },
      structure: { block_type: type, language: block?.language ?? null }
    });
    builder.addEdge({ from: documentNodeId, to: blockNodeId, kind: "source:contains", layer: "source" });

    if (!text || !TEXTUAL_BLOCK_TYPES.has(type)) continue;
    const sentenceRanges = sentenceCharacterRanges(text);
    for (const [sentenceIndex, range] of sentenceRanges.entries()) {
      const exact = text.slice(range.start, range.end);
      const startByte = byteOffset(text, range.start);
      const endByte = byteOffset(text, range.end);
      const sentenceAnchorId = builder.addAnchor({
        blockIndex,
        startByte,
        endByte,
        exact,
        role: "sentence"
      });
      const sentenceNodeId = builder.addNode({
        identity: { kind: "sentence", block_index: blockIndex, start_byte: startByte, end_byte: endByte },
        layer: "source",
        kind: "sentence",
        label: compactLabel(exact),
        anchorIds: [sentenceAnchorId],
        properties: { block_index: blockIndex, sentence_index: sentenceIndex },
        structure: { kind: "sentence", normalized: exact.normalize("NFKC").replace(/\s+/gu, " ").trim() }
      });
      builder.addEdge({
        from: blockNodeId,
        to: sentenceNodeId,
        kind: "source:contains",
        layer: "source",
        anchorIds: [sentenceAnchorId]
      });

      const entityNodeIds = [];
      const canonicalEntityKeys = [];
      const candidates = [
        ...aliasCandidates(exact, aliasRegistry).map((candidate) => ({
          ...candidate,
          kind: candidate.entry.kind,
          label: candidate.entry.label,
          canonical_key: candidate.entry.canonical_key,
          properties: { canonical_key: candidate.entry.canonical_key, matched_alias: candidate.alias, method: "alias" }
        })),
        ...urlCandidates(exact),
        ...packageCandidates(exact),
        ...repositoryCandidates(exact),
        ...pathCandidates(exact)
      ];
      const candidateKeys = new Set();
      for (const candidate of candidates.sort((left, right) => left.start - right.start || left.canonical_key.localeCompare(right.canonical_key))) {
        const candidateKey = `${candidate.canonical_key}\0${candidate.start}\0${candidate.end}`;
        if (candidateKeys.has(candidateKey)) continue;
        candidateKeys.add(candidateKey);
        const occurrence = exact.slice(candidate.start, candidate.end);
        const anchorId = builder.addAnchor({
          blockIndex,
          startByte: startByte + byteOffset(exact, candidate.start),
          endByte: startByte + byteOffset(exact, candidate.end),
          exact: occurrence,
          role: "mention"
        });
        const entityNodeId = builder.addNode({
          identity: { kind: "entity", canonical_key: candidate.canonical_key },
          layer: "reference",
          kind: candidate.kind,
          label: candidate.label,
          anchorIds: [anchorId],
          properties: { canonical_key: candidate.canonical_key, ...(candidate.properties ?? {}) },
          structure: { kind: candidate.kind, canonical_key: candidate.canonical_key }
        });
        entityNodeIds.push(entityNodeId);
        canonicalEntityKeys.push(candidate.canonical_key);
        builder.addEdge({
          from: sentenceNodeId,
          to: entityNodeId,
          kind: "reference:mentions",
          layer: "reference",
          confidence: 1,
          resolution: candidate.properties?.method === "alias" ? "resolved" : "observed",
          anchorIds: [anchorId]
        });
      }

      const wordList = keywords(exact);
      if (normalizedWords(exact).length > 0) {
        const propositionStructure = {
          predicate: wordList[0] ?? null,
          keywords: [...wordList].sort(),
          entities: [...new Set(canonicalEntityKeys)].sort(),
          polarity: polarity(exact),
          modality: modality(exact),
          speaker_role: message.role ?? "unknown"
        };
        const propositionNodeId = builder.addNode({
          identity: { kind: "proposition", sentence_node_id: sentenceNodeId },
          layer: "semantic",
          kind: "proposition",
          label: compactLabel(exact),
          anchorIds: [sentenceAnchorId],
          properties: propositionStructure,
          structure: propositionStructure
        });
        builder.addEdge({
          from: propositionNodeId,
          to: sentenceNodeId,
          kind: "source:grounded-in",
          layer: "semantic",
          anchorIds: [sentenceAnchorId]
        });
        for (const entityNodeId of [...new Set(entityNodeIds)].sort()) {
          builder.addEdge({
            from: propositionNodeId,
            to: entityNodeId,
            kind: "semantic:about",
            layer: "semantic",
            confidence: 1,
            resolution: "parsed",
            anchorIds: [sentenceAnchorId]
          });
        }

        for (const act of classifySpeechActs(exact)) {
          const actNodeId = builder.addNode({
            identity: { kind: "speech-act", act: act.kind, sentence_node_id: sentenceNodeId },
            layer: act.layer,
            kind: act.kind,
            label: act.kind,
            anchorIds: [sentenceAnchorId],
            properties: {
              confidence: act.confidence,
              method: `rule:${act.rule}`,
              speaker_role: message.role ?? "unknown"
            },
            structure: { kind: act.kind, proposition: propositionStructure, speaker_role: message.role ?? "unknown" }
          });
          builder.addEdge({
            from: actNodeId,
            to: propositionNodeId,
            kind: `${act.layer}:qualifies`,
            layer: act.layer,
            confidence: act.confidence,
            resolution: "parsed",
            anchorIds: [sentenceAnchorId],
            properties: { method: `rule:${act.rule}` }
          });
        }
      }
    }
  }

  const anchors = [...builder.anchors.values()].sort((left, right) => left.block_index - right.block_index || left.start_byte - right.start_byte || left.end_byte - right.end_byte || left.anchor_id.localeCompare(right.anchor_id));
  const anchorPosition = new Map(anchors.map((anchor) => [anchor.anchor_id, anchor]));
  const firstPosition = (anchorIds = []) => {
    const values = anchorIds.map((anchorId) => anchorPosition.get(anchorId)).filter(Boolean);
    if (!values.length) return { block_index: -1, start_byte: -1, end_byte: -1 };
    return values.sort((left, right) => left.block_index - right.block_index || left.start_byte - right.start_byte || left.end_byte - right.end_byte)[0];
  };
  const nodes = [...builder.nodes.values()].sort((left, right) => {
    const layer = (LAYER_ORDER.get(left.layer) ?? 999) - (LAYER_ORDER.get(right.layer) ?? 999);
    if (layer) return layer;
    const leftPosition = firstPosition(left.anchor_ids);
    const rightPosition = firstPosition(right.anchor_ids);
    const position = leftPosition.block_index - rightPosition.block_index || leftPosition.start_byte - rightPosition.start_byte || leftPosition.end_byte - rightPosition.end_byte;
    if (position) return position;
    const sourceKind = (SOURCE_KIND_ORDER.get(left.kind) ?? 999) - (SOURCE_KIND_ORDER.get(right.kind) ?? 999);
    return sourceKind || left.kind.localeCompare(right.kind) || left.node_id.localeCompare(right.node_id);
  });
  const edges = [...builder.edges.values()].sort((left, right) => {
    const layer = (LAYER_ORDER.get(left.layer) ?? 999) - (LAYER_ORDER.get(right.layer) ?? 999);
    if (layer) return layer;
    const leftPosition = firstPosition(left.anchor_ids);
    const rightPosition = firstPosition(right.anchor_ids);
    return leftPosition.block_index - rightPosition.block_index
      || leftPosition.start_byte - rightPosition.start_byte
      || left.kind.localeCompare(right.kind)
      || left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.edge_id.localeCompare(right.edge_id);
  });

  return {
    $schema: TEXT_GRAPH_SCHEMA,
    graph_id: graphId,
    analyzer,
    document: {
      revision_oid: normalizedRevisionOid,
      message_hid: message.hid ?? null,
      role: message.role ?? "unknown",
      block_count: blocks.length,
      source_sha256: sha256(sourceText),
      byte_count: blocks.reduce((sum, block) => sum + Buffer.byteLength(blockText(block), "utf8"), 0)
    },
    anchors,
    nodes,
    edges,
    diagnostics
  };
}

const PROJECTION_LAYERS = Object.freeze({
  source: new Set(["source"]),
  concepts: new Set(["reference", "semantic"]),
  work: new Set(["discourse", "work"])
});

export function projectTextGraph(graph, projection = "all") {
  const name = String(projection ?? "all").toLowerCase();
  if (name === "all") return graph;
  const layers = PROJECTION_LAYERS[name];
  if (!layers) throw new Error(`unsupported text graph projection: ${projection}`);
  const allNodes = new Map((graph.nodes ?? []).map((node) => [node.node_id, node]));
  const selected = new Set((graph.nodes ?? []).filter((node) => layers.has(node.layer)).map((node) => node.node_id));

  if (name === "work") {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const edge of graph.edges ?? []) {
        if (selected.has(edge.from)) {
          const target = allNodes.get(edge.to);
          if (target && new Set(["semantic", "reference"]).has(target.layer)) selected.add(target.node_id);
        }
        if (selected.has(edge.to)) {
          const source = allNodes.get(edge.from);
          if (source && new Set(["semantic", "reference"]).has(source.layer)) selected.add(source.node_id);
        }
      }
    }
  }

  const nodes = (graph.nodes ?? []).filter((node) => selected.has(node.node_id));
  const edges = (graph.edges ?? []).filter((edge) => selected.has(edge.from) && selected.has(edge.to));
  const anchorIds = new Set(nodes.flatMap((node) => node.anchor_ids ?? []));
  const anchors = (graph.anchors ?? []).filter((anchor) => anchorIds.has(anchor.anchor_id));
  return {
    $schema: TEXT_PROJECTION_SCHEMA,
    projection: name,
    graph_id: graph.graph_id,
    analyzer: graph.analyzer,
    document: graph.document,
    anchors,
    nodes,
    edges,
    origins: {
      node_ids: nodes.map((node) => node.node_id),
      edge_ids: edges.map((edge) => edge.edge_id),
      anchor_ids: anchors.map((anchor) => anchor.anchor_id)
    }
  };
}
