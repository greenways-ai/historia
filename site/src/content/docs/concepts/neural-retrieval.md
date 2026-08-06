---
title: Neural topic retrieval
description: Optional local semantic ranking over Historia's anchored text graphs and topic evidence.
---

Historia's neural layer is an **optional ranking projection** over the existing
text graph and topic index. It encodes immutable message revisions and topic
labels, then retrieves semantically nearby topics and their supporting original
messages.

It does not replace lexical search or make semantic claims. Every result still
includes the source ref, archive commit, message revision, graph evidence, and
original text.

## Pipeline

```text
immutable message revision
  → anchored text graph
  → graph-backed topic mentions
  → optional MiniLM vectors
  → direct and one-hop topic ranking
  → original messages for an LLM
```

## Commands

```bash
bun add @huggingface/transformers
historia neural index
historia neural search "private channels for external agents"
historia neural status
```

CPU/WASM defaults to a quantized profile. WebGPU can use fp16 where supported:

```bash
historia neural index --device webgpu --dtype fp16 --batch-size 32
```

The model is pinned by revision and cached by a fingerprint that includes its
runtime, device, dtype, pooling, normalization, dimensions, and classifier
prototypes. The neural tables are rebuildable SQLite projections; Git remains
authoritative.

See `spec/chat-neural-index.md` in the source repository for the storage,
classification, retrieval, and privacy contracts.
