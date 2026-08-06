---
title: Text graphs and topics
description: Project immutable chat text into anchored graphs, then use those graphs to rank potentially related topics for LLM retrieval.
---

Historia text graphs are rebuildable structural projections of immutable message revisions. Every evidence-bearing node and edge points back to an exact UTF-8 byte range in a typed message block.

The first analyzer is deterministic and non-neural. It extracts source structure, configured project entities, explicit artifacts, shallow propositions, and rule-derived speech acts such as requests, constraints, proposals, decisions, acceptance, rejection, and status.

A graph-backed topic projection then turns reference nodes, proposition phrases, and keywords into retrieval handles. Work and discourse nodes remain graph structure: they qualify nearby topics and improve ranking instead of becoming unsupported semantic claims.

Build missing graphs and topics after importing conversations:

```bash
historia graph index
```

Inspect the complete graph or one reversible projection:

```bash
historia graph show <revision-oid>
historia graph show <revision-oid> --projection source
historia graph show <revision-oid> --projection concepts
historia graph show <revision-oid> --projection work
```

Inspect the topic plan for a query:

```bash
historia topic search "private agent rooms"
```

Use the topic graph to expand ordinary lexical retrieval:

```bash
historia chat search "private agent communication" --expand-topics

historia context build \
  "private agent communication" \
  --expand-topics \
  --budget 12000
```

The topic layer stores direct graph-node links, local proposition context, work/discourse facets, and bounded evidence for one-hop associations. Context bundles distinguish lexical matches, direct-topic matches, and associated-topic matches so an LLM can understand why each original message was selected.

Git remains authoritative. SQLite stores the complete derived graph, topic mentions, and topic associations; all can be deleted and rebuilt.

The message-local analyzer still does not infer cross-message acceptance, rejection, answers, or task transitions. Those relations require a later conversation-snapshot projector over Historia's reply graph, branches, and active paths.

See the [text graph specification](https://github.com/greenways-ai/historia/blob/main/spec/text-graph.md) and [topic index specification](https://github.com/greenways-ai/historia/blob/main/spec/chat-topic-index.md).
