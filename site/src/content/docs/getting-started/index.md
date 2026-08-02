---
title: Install and quick start
description: Install Historian and create your first temporal code index.
---

Historian requires Bun 1.2.18 or newer and Git 2.43 or newer. Python analysis requires Python 3.10 or newer; Clojure analysis uses Babashka and clj-kondo.

```bash
npm install -g @greenways-ai/historian
gw-historian doctor
cp greenways-historian.example.json greenways-historian.json
gw-historian init
gw-historian index /path/to/repository
```

Query the indexed history:

```bash
gw-historian search "qualified symbol"
gw-historian retrieve "historical context"
gw-historian similar "example.core/answer"
gw-historian history "example.core/answer"
gw-historian trace "revision-id"
```

The default database is `.greenways-historian/index.sqlite`. It uses SQLite WAL mode and content-addressed analyzer results.
