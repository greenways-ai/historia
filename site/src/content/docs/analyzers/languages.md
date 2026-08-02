---
title: Language analyzers
description: Deterministic analyzers for JavaScript, TypeScript, Python, and Clojure.
---

Historian ships analyzers for JavaScript and TypeScript through Bun, Python through the standard-library AST, and Clojure through Babashka and clj-kondo. Every worker emits the same JSONL protocol for symbols, references, diagnostics, and structural features.
