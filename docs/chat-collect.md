# Collecting ChatGPT history

Historia Collect stores AI conversation exports in a local bare Git repository.
Git blobs are authoritative; the SQLite search and context projection can be
recreated from the source refs.

## Initialize a vault

```bash
historia vault init
```

The default path is platform-specific and can be overridden with either
`HISTORIA_VAULT` or `--vault`.

```bash
historia vault init --vault ~/historia/vault.git
```

## Inspect an export

Historia accepts a ChatGPT export ZIP, an extracted export directory, a
`conversations.json` file, or numbered conversation JSON files.

```bash
historia chat inspect-openai ~/Downloads/chatgpt-export.zip
```

Inspection reports the source key, archive digest, conversation/message counts,
branch points, and a compact conversation summary without changing the vault.

ZIP import currently requires the `unzip` command. Importing an extracted
directory or JSON file does not.

## Import an export

```bash
historia chat import-openai ~/Downloads/chatgpt-export.zip
```

`historia collect import-openai` is an equivalent command intended for the
desktop and browser collection workflow. Both commands update the rebuildable
chat index after committing the archive transaction. Use `--no-index` to archive
without updating that projection.

By default Historia preserves:

- the exact extracted export files;
- a deterministic file manifest with SHA-256 digests;
- raw provider conversation and message records;
- normalized branch-aware conversation manifests;
- content-addressed normalized message revisions;
- an import receipt under the source ref.

Observation timestamps live in manifests and receipts rather than normalized
message blobs. An unchanged provider message therefore retains the same Git OID
across later account exports, while an edited message produces a new revision.

Use `--no-raw` to skip copying the exact extracted files. Raw provider message
and conversation records plus the export manifest are still retained.

```bash
historia chat import-openai export.zip --no-raw
```

Use `--source` when an export lacks stable account metadata, or `--ref` to place
an import on a specific Historia source ref.

```bash
historia chat import-openai conversations.json \
  --source personal-openai \
  --ref refs/historia/sources/openai/personal
```

The deterministic receipt path makes re-importing the same archive with the same
importer version idempotent.

## Verify the vault

```bash
historia vault verify
```

This runs Git object and reachability checks. A bare vault may report that its
ordinary `HEAD` is unborn because Historia uses `refs/historia/*` rather than a
checked-out default branch; that notice is not an integrity failure.

## Search and agent context

Build or refresh the index, search messages, and produce a bounded context file:

```bash
historia chat index
historia chat search "private agent negotiation"
historia context build "private agent negotiation" --format markdown --output /tmp/context.md
```

See [`chat-search.md`](chat-search.md) for temporal search, conversation
snapshots, context packing, filters, and provenance.

## Browser collection

The local native-messaging host and unpacked browser extension write rendered
ChatGPT observations through the same Git archive and SQLite projection:

```bash
historia collect capture-json observation.json
historia collect status
```

See [`browser-collect.md`](browser-collect.md) for extension loading, native-host
manifest generation, caller restrictions, manual collection, and opt-in
automatic collection.

Browser captures are labelled `browser-observed` and remain distinct from full
provider exports. They can fill the gap between account exports without being
mistaken for a complete account snapshot.

## Local Collect application

Start the private archive interface with:

```bash
historia collect serve
```

It provides local export import, source health, full-text archive search,
branch-aware conversation inspection, provenance-rich context building, and an
archive transaction ledger. See [`docs/collect-app.md`](collect-app.md).
