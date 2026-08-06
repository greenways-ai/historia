# Text graphs

Historia can build a deterministic structural graph for every immutable chat
message revision. The graph keeps exact source anchors while exposing several
views of the same text: source structure, concepts, and work-oriented speech
acts.

The graph index is optional and rebuildable. Git remains the source of truth.

## Build the graph index

First import and index conversations normally, then build any missing text
graphs:

```bash
historia chat import-openai ~/Downloads/chatgpt-export.zip
historia graph index
```

`historia graph index` refreshes the ordinary chat index first. It then analyzes
only message revisions that do not already have a graph for the built-in
analyzer fingerprint.

Limit one pass when testing a large archive:

```bash
historia graph index --limit 1000
```

Rebuild the chat projection and graph projection together:

```bash
historia graph index --rebuild
```

## Inspect a graph

Use an immutable revision OID, logical message HID, or graph ID:

```bash
historia graph show <revision-oid>
```

A logical message HID resolves to its most recent indexed revision for the
built-in analyzer.

Select one projection:

```bash
historia graph show <revision-oid> --projection source
historia graph show <revision-oid> --projection concepts
historia graph show <revision-oid> --projection work
```

Write JSON to a file:

```bash
historia graph show <revision-oid> \
  --projection work \
  --output /tmp/historia-work-graph.json
```

## What the built-in analyzer extracts

The first implementation is deliberately non-neural and message-local. It
emits:

- message, typed block, and sentence containment;
- exact UTF-8 byte anchors;
- configured Greenways project entities;
- explicit URLs, GitHub repositories, package names, and file paths;
- shallow proposition nodes with polarity, modality, and keywords;
- deterministic rules for questions, requests, proposals, constraints,
  decisions, acceptance, rejection, rationale, corrections, and status.

It does not claim that one message accepts or rejects another message. Those
relations need a conversation-snapshot projector that can inspect reply edges,
branches, active paths, and later turns.

## Provenance and verification

Every evidence anchor contains the message revision OID, block index, half-open
UTF-8 byte range, exact text, and an exact-text SHA-256 digest. A consumer can
verify an anchor by loading the normalized message object from the Historia Git
vault and slicing the addressed block bytes.

Node `source_hash` values follow exact evidence. Node `structural_hash` values
follow normalized graph structure and can be used as evidence for later lineage
matching. Neither hash automatically establishes cross-conversation identity.

## Extending the analyzer

The default entity registry is intentionally small and domain-specific. A later
analyzer protocol can supply project registries, alternative language
segmenters, classical statistical classifiers, or neural semantic layers. Each
configuration must carry a distinct analyzer fingerprint so multiple derived
interpretations can coexist without overwriting one another.

See `spec/text-graph.md` and the JSON schemas for the compatibility contract.
