---
title: Text graphs
description: Project immutable chat text into source, concept, and work graphs without losing exact provenance.
---

Historia text graphs are rebuildable structural projections of immutable message revisions. Every evidence-bearing node and edge points back to an exact UTF-8 byte range in a typed message block.

The first analyzer is deterministic and non-neural. It extracts source structure, configured project entities, explicit artifacts, shallow propositions, and rule-derived speech acts such as requests, constraints, proposals, decisions, acceptance, rejection, and status.

Build missing graphs after importing conversations:

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

Git remains authoritative. SQLite stores the complete derived graph plus promoted anchor, node, and edge tables that can be deleted and rebuilt.

The message-local analyzer does not infer cross-message acceptance, rejection, answers, or task transitions. Those relations require a later conversation-snapshot projector over Historia's reply graph, branches, and active paths.

See the [text graph specification](https://github.com/greenways-ai/historia/blob/main/spec/text-graph.md) for identity, anchoring, layering, and compatibility rules.
