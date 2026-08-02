---
title: Temporal index
description: How Historian maps Git ancestry into deterministic code history.
---

Historian walks the commit DAG, identifies changed blobs, and analyzes each unique content object once. Git remains authoritative; SQLite is a rebuildable retrieval index.

The temporal model separates revisions, file identities, symbols, analyzer results, and retrieval documents so `update` can process only newly reachable commits while preserving earlier lineage.

See the [temporal index specification](https://github.com/greenways-ai/historian/blob/main/spec/temporal-index.md) for the storage contract.
