# Historia Neural Topic Index 0.1

Status: experimental implementation specification

## Purpose

The neural topic index adds fast, optional semantic ranking to Historia's
existing graph-backed topic retrieval. It does not replace Git, immutable
message revisions, text graphs, lexical FTS, or topic evidence.

The neural layer has two responsibilities:

1. encode messages and topic labels into normalized dense vectors;
2. classify messages and queries against a small, fixed set of structural
   prototypes such as `request`, `constraint`, `decision`, and `rationale`.

The final result always resolves to original Historia message revisions and
archive provenance. Similarity is a retrieval signal, not a factual assertion.

## Runtime boundary

The core package does not require a neural runtime. An encoder is supplied to
the indexer through a small interface:

```text
embed(list<string>) -> list<vector<float32>>
```

Historia includes an optional Transformers.js adapter. It dynamically loads
`@huggingface/transformers`, creates a `feature-extraction` pipeline, applies
mean pooling and L2 normalization, and defaults to a pinned
`Xenova/all-MiniLM-L6-v2` revision.

An implementation MUST expose a stable descriptor containing at least:

- runtime and runtime module;
- model identifier and immutable revision;
- device and numeric type;
- pooling and normalization;
- dimensions;
- classifier strategy and label prototypes;
- descriptor fingerprint.

The fingerprint is part of every cache key. A change to any semantic model or
classifier setting creates a separate projection.

## Storage

The SQLite projection stores:

- model descriptors;
- one normalized float32 vector and structural-label result per immutable
  message revision and model fingerprint;
- one normalized float32 vector per topic and model fingerprint.

Topic vectors are keyed by a digest of the topic label and aliases. If aliases
change, that topic is re-encoded without rebuilding unchanged messages.

All neural tables are derived and MAY be deleted and rebuilt. The Git vault and
normalized messages remain authoritative.

## Classification

The first implementation uses prototype classification rather than a trained
softmax head. Each structural label has a natural-language prototype. The
encoder embeds those prototypes once, then scores a message or query using
cosine similarity.

The initial label vocabulary is:

```text
question
request
proposal
constraint
rejection
acceptance
decision
status
rationale
correction
```

Classification is multi-label. Scores and thresholds are retained as derived
signals; they do not alter deterministic text-graph nodes.

## Retrieval

A query is encoded once. Historia then:

1. finds the nearest indexed topics;
2. optionally expands one hop through existing topic associations;
3. retrieves supporting topic mentions and their graph evidence;
4. compares the query with candidate message vectors;
5. boosts candidates whose structural labels or deterministic graph facets
   match the query labels;
6. resolves current or historical message observations;
7. returns original text and archive provenance.

The initial ranking function is deliberately simple and inspectable:

```text
0.58 * graph-backed topic score
+ 0.34 * query-to-message cosine similarity
+ 0.08 * structural-label overlap
```

These coefficients are implementation defaults rather than semantic claims.

## Privacy and network behavior

Neural indexing is opt-in. The deterministic archive, graph, topic, and lexical
search paths continue to work without a model or network access.

The Transformers.js adapter may download model assets on first use. Operators
can set a local cache and disable remote model access. Historia never sends chat
text to a hosted inference API in this adapter.

## Rebuildability

Given the same:

- Git vault heads;
- normalized message revisions;
- graph and topic projections;
- model revision;
- tokenizer/model assets;
- device/dtype profile;
- label prototypes;

Historia can rebuild the neural projection. Small floating-point differences
between execution providers are isolated by including the execution profile in
the model fingerprint.
