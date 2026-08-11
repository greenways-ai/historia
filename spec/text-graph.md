# Historia Text Graph 0.1

Status: experimental specification

## Purpose

A Historia text graph is a rebuildable structural projection of one immutable
normalized chat message revision. The original message object and its Git object
ID remain authoritative. Graph nodes and edges interpret the message; they do
not replace or rewrite it.

The initial format is `historia.text.graph/0-alpha`. Its canonical JSON schema is
`spec/text-graph-v1.schema.json`.

## Invariants

An implementation MUST preserve these invariants:

1. `document.revision_oid` identifies the immutable normalized message revision.
2. Every evidence-bearing node and edge resolves through one or more anchors to
   exact UTF-8 bytes in a typed message block.
3. Anchor ranges are half-open: `start_byte` is inclusive and `end_byte` is
   exclusive.
4. Stable graph, anchor, node, and edge IDs are derived from canonical inputs and
   the analyzer fingerprint.
5. Analyzer output is a derived projection and MAY be deleted and rebuilt.
6. A changed analyzer, rule set, or entity registry MUST use a different
   fingerprint.
7. A projection MUST retain the IDs of the base graph objects from which it was
   selected.

## Analysis scope

The v1 built-in analyzer is message-local. It MAY derive facts from the supplied
message and an explicit alias registry. It MUST NOT inspect other messages,
conversation branches, Git history, repositories, or network resources.

Conversation-level relations such as `answers`, `accepts`, `rejects`,
`supersedes`, and task-state transitions require a later snapshot projector.
They must not be invented by the message-local analyzer.

## Layers

The shared layer vocabulary is:

- `source`: message, block, sentence, and containment structure;
- `reference`: entity mentions, URLs, repositories, packages, and paths;
- `semantic`: shallow propositions and their subject matter;
- `discourse`: questions, proposals, acceptance, rejection, rationale, and
  corrections;
- `work`: requests, constraints, decisions, and status statements;
- `lineage`: logical identities and transitions added by later projectors;
- `provenance`: analysis and observation relationships added by later
  projectors.

Unknown node and edge kinds within these layers are forward-compatible.
Consumers should use the layer for broad selection and the namespaced `kind`
for precise behavior.

## Anchors

An anchor contains:

```json
{
  "anchor_id": "historia:text-anchor:<sha256>",
  "revision_oid": "<git-object-id>",
  "block_index": 0,
  "start_byte": 12,
  "end_byte": 31,
  "exact_sha256": "<sha256>",
  "exact": "Historia text graph",
  "role": "mention"
}
```

The `exact` field is redundant by design. It lets consumers verify the anchor
without first materializing the source object. The authoritative value remains
the block text addressed by the revision OID and byte range.

## Nodes

Every node declares a layer, kind, human-readable label, evidence anchors,
source hash, structural hash, and kind-specific properties.

`source_hash` changes when the exact supporting text changes.
`structural_hash` is computed over a normalized structure and may remain stable
when wording or formatting changes. It is therefore suitable as one input to
later fuzzy lineage matching, but it is not a global logical identity.

The built-in analyzer emits:

- source message, block, and sentence nodes;
- canonical reference nodes for configured aliases and explicit artifacts;
- one shallow proposition per non-empty sentence;
- deterministic rule-derived discourse and work nodes.

## Edges

Edges are directed and typed. Every edge records a confidence and resolution
class. The initial resolution vocabulary is:

- `observed`: explicit in provider text or archive structure;
- `parsed`: produced by deterministic parsing or rules;
- `resolved`: mapped to an explicit canonical identity;
- `inferred`: derived from contextual evidence;
- `curated`: confirmed by a human;
- `generated`: synthesized by a generative model;
- `candidate`: proposed for later resolution.

Message-local v1 output uses only `observed`, `parsed`, and `resolved`.

## Projections

The companion `historia.text.projection/0-alpha` format selects a reversible view of
one base graph. The built-in projections are:

- `source`: messages, blocks, sentences, and containment;
- `concepts`: reference and semantic nodes;
- `work`: discourse and work nodes plus connected semantic and reference nodes.

Projection objects retain the base `graph_id` and explicit origin ID lists. They
must not mint replacement identities for selected objects.

## Persistence

SQLite is a rebuildable projection. The complete canonical graph is stored in
`chat_text_graphs.graph_json`; anchors, nodes, and edges required for traversal
are promoted into normalized tables.

The built-in graph index is opt-in:

```text
historia graph index
```

This separation keeps the existing Git-and-FTS chat index behavior unchanged
while the graph representation is experimental.

## Compatibility

Minor revisions may add optional fields, layers, node kinds, edge kinds, or
resolution values. Consumers MUST ignore unknown optional properties. Removing
fields, changing anchor coordinate semantics, or changing ID derivation requires
a new schema version.
