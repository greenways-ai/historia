# Historia Chat Topic Index 1.0

Status: Draft implementation specification

## Purpose

The topic index is a rebuildable retrieval projection over Historia text graphs.
It identifies candidate topics, links each topic occurrence to the graph nodes
that support it, and stores weighted evidence that two topics may be related.
It does not replace message text or claim that an association is a semantic fact.

Git message revisions remain authoritative. SQLite topic tables may be deleted
and rebuilt from stored text graphs.

## Topic identity

A topic has:

- a stable `topic_id` derived from `kind` and normalized key;
- a `kind`, such as `project`, `repository`, `package`, `path`, `url`, `phrase`,
  or `keyword`;
- a preferred label;
- zero or more aliases.

Topic identity is independent of one graph revision. Extractor versions are
recorded on mentions and association edges rather than embedded in `topic_id`.
This permits the same canonical topic to survive a rebuild with a compatible
extractor while keeping derivation fingerprints explicit.

## Mentions and graph links

Every topic mention records:

```text
topic_id
graph_id
graph_node_id
context_node_id
revision_oid
message_hid
conversation_hid
relation
weight
anchor_ids
support_node_ids
facets
extractor_fingerprint
```

`graph_node_id` is the node that directly produced the topic. Reference topics
normally point to a reference node. Phrase and keyword topics normally point to
a proposition node.

`context_node_id` identifies the local proposition or graph context used for
co-occurrence. `support_node_ids` can additionally include qualifying work or
discourse nodes. `facets` provides a compact ranking-oriented view of those
qualifiers, for example `decision`, `constraint`, `proposal`, or `request`.

Facets are ranking evidence, not independent assertions about the whole
conversation.

## Candidate extraction

The built-in extractor promotes:

1. configured project and entity references;
2. explicit repositories, URLs, packages, and paths;
3. bounded proposition phrases;
4. bounded proposition keywords.

Reference topics receive more base weight than phrases and keywords. A work or
discourse facet can increase a mention's weight. The extractor is deterministic,
non-neural, and fingerprinted.

## Associations

The index stores one undirected edge for a canonical topic pair. Evidence is
accumulated from bounded contexts:

- same proposition: strong;
- same message: weak;
- direct reply pair: medium.

The stored score is normalized by both topics' document frequency. This reduces
the influence of corpus-wide generic terms.

Every edge records:

```text
left_topic_id
right_topic_id
extractor_fingerprint
weighted_support
support_count
association_score
evidence
```

Evidence is bounded and points back to graph, revision, message, or reply
contexts. An edge means only "potentially related for retrieval."

## Retrieval

A topic-expanded query performs:

1. lexical topic lookup to select seed topics;
2. one-hop association traversal;
3. topic-to-message lookup through graph-linked mentions;
4. graph-facet weighting;
5. fusion with ordinary SQLite FTS5 message results;
6. current/historical revision resolution and normal Historia filters;
7. provenance-rich context packaging.

Direct topic matches receive more weight than associated-topic matches.
Traversal depth is fixed at one in version 1.0.

Search and context output must distinguish:

- lexical retrieval;
- direct-topic retrieval;
- associated-topic retrieval.

## Rebuildability

A graph is topic-indexed once per topic-extractor fingerprint. The SQLite topic
projection has one active extractor fingerprint. When that fingerprint changes,
Historia clears topic search rows, mentions, checkpoints, associations, and the
association-state checkpoint before deterministically reprocessing stored text
graphs. Compatible text-graph analyses remain untouched.

Association rebuilding is skipped when the active graph count and direct-reply
edge count have not changed. This keeps topic-expanded retrieval inexpensive
while preserving an explicit `--rebuild` path.

The authoritative message archive and text graph JSON are not modified.
