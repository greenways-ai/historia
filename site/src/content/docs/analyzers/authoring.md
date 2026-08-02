---
title: Analyzer authoring and conformance
description: Implement another deterministic Historian analyzer.
---

An analyzer is a long-lived JSONL worker. It must implement `describe` and `analyze`, return deterministic results for identical blobs, and satisfy the shared conformance fixtures.

Read the complete [analyzer authoring guide](https://github.com/greenways-ai/historian/blob/main/docs/analyzer-authoring.md) before adding a language worker.
