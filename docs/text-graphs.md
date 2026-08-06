# Text graphs and topic retrieval

Historia can build a deterministic structural graph for every immutable chat
message revision. The graph keeps exact source anchors while exposing several
views of the same text: source structure, concepts, and work-oriented speech
acts.

A second rebuildable projection turns graph nodes into candidate topics. Topics
are not treated as authoritative semantic facts. They are retrieval handles that
help an LLM find potentially related messages and then read the original text.
Git remains the source of truth for every message and revision.

## Build the graph and topic indexes

First import and index conversations normally, then build the graph projection:

```bash
historia chat import-openai ~/Downloads/chatgpt-export.zip
historia graph index
```

`historia graph index` now refreshes the ordinary chat index, creates any missing
message-local graphs, and indexes graph-backed topics and their associations.
Only missing immutable revisions are analyzed.

The topic projection can also be managed independently:

```bash
historia topic index
historia topic index --rebuild
```

Limit one pass when testing a large archive:

```bash
historia graph index --limit 1000
historia topic index --limit 1000
```

Rebuild the chat, graph, and topic projections together:

```bash
historia graph index --rebuild
```

## Inspect a graph

Use an immutable revision OID, logical message HID, or graph ID:

```bash
historia graph show <revision-oid>
```

A logical message HID resolves to its most recent indexed revision for the
built-in analyzer.

Select one projection:

```bash
historia graph show <revision-oid> --projection source
historia graph show <revision-oid> --projection concepts
historia graph show <revision-oid> --projection work
```

Write JSON to a file:

```bash
historia graph show <revision-oid> \
  --projection work \
  --output /tmp/historia-work-graph.json
```

## Search topics

Inspect seed topics, one-hop related topics, and the message revisions they
suggest:

```bash
historia topic search "private agent rooms"
```

Topic search returns three distinct sets:

- direct seed topics found from the query;
- related topics connected by graph-backed co-occurrence;
- candidate message revisions with graph nodes, facets, and contribution scores.

The relation is deliberately phrased as "potentially related." The LLM still
receives and interprets the original messages.

## Expand chat retrieval with topics

Use topic expansion when lexical search alone is too narrow:

```bash
historia chat search "private agent communication" --expand-topics

historia context build \
  "private agent communication" \
  --expand-topics \
  --budget 12000
```

The ranking combines ordinary SQLite FTS5 results with topic candidates using
reciprocal-rank-style fusion. Direct topic matches receive more weight than
one-hop associated topics. Existing current-versus-historical revision handling,
source filters, role filters, and exact provenance remain in force.

Bound expansion when needed:

```bash
historia context build "query" \
  --expand-topics \
  --topic-seed-limit 6 \
  --topic-limit 12 \
  --topic-min-support 2
```

Context bundles record whether each selected message was retrieved lexically,
through a direct topic, or through a related topic. Topic-derived matches also
include the graph node IDs and work/discourse facets that affected ranking.

## How graph nodes become topics

The first topic extractor is deterministic and non-neural.

Strong topic candidates come from reference nodes:

- configured Greenways projects;
- GitHub repositories;
- package names;
- file paths;
- explicit URLs.

Weaker topic candidates come from proposition phrases and keywords. A topic
mention points to the graph node that produced it and to the proposition that
provides its local context.

Speech-act and work nodes do not become unrelated standalone topics. Instead,
they qualify nearby topics and adjust ranking. For example, a mention inside a
`decision` or `constraint` receives more weight than the same phrase in casual
prose.

## Topic associations

Historia accumulates weighted evidence in bounded windows:

| Evidence | Relative weight |
|---|---:|
| Same proposition | High |
| Same message | Low |
| Direct reply pair | Medium |

Association scores are normalized by topic document frequency so common terms
do not connect to everything. Every stored topic edge retains a bounded list of
supporting graph/message contexts.

Only one association hop is used for retrieval in this version. This avoids the
semantic drift and graph explosion caused by unbounded traversal.

## What the built-in graph analyzer extracts

The message-local graph analyzer emits:

- message, typed block, and sentence containment;
- exact UTF-8 byte anchors;
- configured Greenways project entities;
- explicit URLs, GitHub repositories, package names, and file paths;
- shallow proposition nodes with polarity, modality, and keywords;
- deterministic rules for questions, requests, proposals, constraints,
  decisions, acceptance, rejection, rationale, corrections, and status.

It does not claim that one message accepts or rejects another message. Those
relations need a conversation-snapshot projector that can inspect reply edges,
branches, active paths, and later turns.

## Provenance and verification

Every evidence anchor contains the message revision OID, block index, half-open
UTF-8 byte range, exact text, and an exact-text SHA-256 digest. A consumer can
verify an anchor by loading the normalized message object from the Historia Git
vault and slicing the addressed block bytes.

A topic mention stores:

```text
topic
  → graph node
  → proposition context
  → supporting work/discourse nodes
  → exact graph anchors
  → immutable message revision
```

Node `source_hash` values follow exact evidence. Node `structural_hash` values
follow normalized graph structure and can be used as evidence for later lineage
matching. Neither a structural match nor a topic edge automatically establishes
cross-conversation identity.

## Extending the analyzer

The default entity registry is intentionally small and domain-specific. A later
analyzer protocol can supply project registries, alternative language
segmenters, classical statistical classifiers, or neural semantic layers. Each
text-graph configuration carries a distinct analyzer fingerprint. The topic
projection maintains one active extractor fingerprint and rebuilds itself when
that fingerprint changes, preventing incompatible ranking models from mixing.

See `spec/text-graph.md`, `spec/chat-topic-index.md`, and the JSON schemas for
the compatibility contracts.
