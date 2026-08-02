---
title: CLI reference
description: Historian command groups and their operating purpose.
---

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

Run `gw-historian <command> --help` against the installed version for all current flags.
