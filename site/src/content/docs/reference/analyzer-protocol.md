---
title: Analyzer protocol
description: The language-neutral JSONL contract used by Historian analyzers.
---

The protocol defines `describe` and `analyze` requests, mutually exclusive result/error responses, normalized symbol records, references, diagnostics, and structural features.

Consult the versioned [protocol specification](https://github.com/greenways-ai/historian/blob/main/spec/analyzer-protocol.md) and JSON schema fixtures when implementing a worker.
