---
title: CLI reference
description: Historian and Historia command groups and their operating purpose.
---

## Code Historian

| Command | Purpose |
| --- | --- |
| `doctor` | Validate runtime and analyzer dependencies. |
| `init` | Create an index schema. |
| `index` | Build history from a complete repository. |
| `update` | Process newly reachable commits and changed blobs. |
| `search` | Find indexed symbols and documents. |
| `retrieve` | Retrieve historical context. |
| `similar` | Find structurally similar symbols. |
| `changes` | Find revisions related to a query. |
| `history` | Show a symbol timeline. |
| `trace` | Follow bounded lineage paths. |

## Conversation Historia

| Command | Purpose |
| --- | --- |
| `historia chat index` | Refresh the rebuildable conversation projection. |
| `historia chat search <query>` | Search current or historical message revisions with SQLite FTS5. |
| `historia graph index` | Build missing anchored text graphs and graph-backed topics. |
| `historia graph show <id>` | Inspect a complete graph or `source`, `concepts`, or `work` projection. |
| `historia topic index` | Build or rebuild the topic and association projection from stored graphs. |
| `historia topic search <query>` | Show direct topics, one-hop related topics, and candidate message revisions. |
| `historia context build <query>` | Create a bounded, provenance-rich context bundle for an LLM or local agent. |

Use topic expansion when archived discussions may use different wording:

```bash
historia chat search "query" --expand-topics
historia context build "query" --expand-topics --budget 12000
```

Bound lateral retrieval with:

```text
--topic-seed-limit <n>
--topic-limit <n>
--topic-min-support <n>
```

Run `gw-historian <command> --help` or `historia --help` against the installed
version for all current flags.
