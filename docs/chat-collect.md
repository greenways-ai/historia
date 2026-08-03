# Collecting ChatGPT history

Historia Collect stores AI conversation exports in a local bare Git repository.
Git blobs are authoritative; future SQLite search and context projections can be
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
future desktop and browser collection workflow.

By default Historia preserves:

- the exact extracted export files;
- a deterministic file manifest with SHA-256 digests;
- raw provider conversation and message records;
- normalized branch-aware conversation manifests;
- content-addressed normalized message revisions;
- an import receipt under the source ref.

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

## Current boundary

This first implementation covers official export ingestion and the Git archive
contract. Browser-native collection, SQLite chat search, context packing, and
CLI agent skills are subsequent layers built on the same refs and schemas.
