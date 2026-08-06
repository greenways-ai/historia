# Optional neural topic retrieval

Historia can add a fast local neural ranking layer to the deterministic text
graph and topic index. It is optional: imports, lexical search, graph indexing,
and topic-expanded context continue to work without a neural runtime.

## Install the runtime

From a source checkout:

```bash
bun add @huggingface/transformers
```

Standalone binaries can load an external module by setting an importable module
specifier or file URL:

```bash
export HISTORIA_TRANSFORMERS_MODULE=file:///absolute/path/to/transformers.js
```

The default model is `Xenova/all-MiniLM-L6-v2`, pinned to the revision recorded
by `historia neural status`. It produces 384-dimensional normalized sentence
vectors.

## Index

```bash
historia neural index
```

The command first refreshes the chat, text-graph, and graph-backed topic
projections. It then stores vectors for missing immutable message revisions and
changed topic labels.

Useful execution profiles:

```bash
# CPU/WASM; q8 is the default
historia neural index --device wasm --dtype q8 --batch-size 16

# WebGPU where supported by the installed runtime
historia neural index --device webgpu --dtype fp16 --batch-size 32
```

Use a local cache and prohibit downloads after the model is present:

```bash
export HISTORIA_NEURAL_CACHE="$HOME/.cache/historia/models"
historia neural index --local-files-only
```

Rebuild only the selected model projection:

```bash
historia neural index --rebuild
```

## Search

```bash
historia neural search "confidential channels for external agents"
```

The result reports:

- query structural labels;
- nearest direct topics;
- one-hop related topics;
- topic, message-similarity, and label-overlap scores;
- graph IDs and graph-node evidence;
- original message content;
- Historia source ref, archive commit, and message path.

Common controls:

```bash
historia neural search "why did we change the Hestia positioning?" \
  --neural-topic-limit 10 \
  --neural-related-limit 12 \
  --neural-min-score 0.30 \
  --limit 20
```

## Status

`status` never loads or downloads a model:

```bash
historia neural status
```

It lists stored model fingerprints, execution profiles, dimensions, message
vectors, and topic vectors.

## Trust boundary

A neural match means "potentially relevant for retrieval." It does not mean two
topics are identical, that a claim is true, or that a decision was accepted.
The downstream LLM receives the original messages and exact Historia
provenance, and performs the contextual interpretation there.
