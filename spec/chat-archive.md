# Historia Chat Archive v1

## Status

This document defines the first storage contract for Git-native AI conversation
history in Historia. It complements the code-oriented temporal index. It does
not replace or overload the existing symbol, revision, and source-location
schema.

## Goals

Historia Chat Archive MUST:

- retain the exact provider records needed to re-normalize an import;
- store normalized messages as reachable Git blobs;
- preserve regenerated branches and edited message revisions;
- distinguish provider time from observation and import time;
- make repeated imports of the same source archive idempotent;
- keep SQLite and future search projections rebuildable from Git;
- operate locally without an LLM, vector database, or remote service;
- expose provenance sufficient to resolve every normalized record back to the
  raw record and import transaction that produced it.

Historia Chat Archive does not claim that a browser observation or locally
signed commit proves provider authorship. Provenance records what Historia
observed, through which importer, and when.

## Repository model

A Historia chat vault is a bare Git repository. It has no required worktree.
Content is stored as blobs, organized into trees, and made reachable by import
commits under dedicated refs.

V1 source refs use:

```text
refs/historia/sources/<provider>/<source-key-digest>
```

An import commit represents one atomic archive transaction. A commit MUST NOT
represent an individual message. The commit parent is the previous head of the
same source ref. The ref update MUST use compare-and-swap semantics so two
collectors cannot silently overwrite one another.

The Git commit timestamp records the observation/import event. Provider message
and conversation timestamps remain fields in normalized records and MUST NOT be
replaced by commit time.

## Tree layout

The logical tree rooted at a source ref contains:

```text
sources/
  openai/<source-key-digest>/source.json

conversations/
  <shard>/<conversation-key>/manifest.json

messages/
  <shard>/<normalized-message-oid>/message.json

raw/messages/
  <shard>/<raw-message-oid>/message.json

raw/conversations/
  <shard>/<raw-conversation-oid>/conversation.json

raw/exports/
  <archive-sha256>/manifest.json
  <archive-sha256>/files/<encoded-provider-path>

imports/
  openai/<archive-sha256>/<importer-version>/<profile>.json
```

Paths organize reachable objects; identity does not depend on a checkout path.
Content-addressed message paths MAY be shared by many conversations or imports.

## Source identity

A source is one provider account or other stable collection origin. Importers
SHOULD derive a source key from a provider account identifier supplied in the
export. Raw email addresses and account identifiers MUST NOT be used directly
in Git refs or tree paths. When no stable provider identifier exists, the user
MAY supply an explicit source key.

A normalized source key is stable for the same account and provider. The source
record MAY retain provider metadata inside the private vault.

## Raw and normalized records

Every normalized message MUST reference a raw provider message blob through
`raw_oid`. Unknown provider content MUST be retained in a generic provider block
rather than discarded.

The raw export file manifest records the relative path, byte count, and SHA-256
of each imported file. When raw-file retention is enabled, exact extracted files
are stored beneath the archive digest. A container ZIP hash MAY also be recorded,
but the canonical archive digest is calculated from normalized relative paths
and file contents so equivalent re-packaging remains idempotent.

## Conversation graph

A conversation is a directed graph, not a flat transcript. Each message node is
identified by a logical Historia ID and points to a normalized message revision
blob. Edges preserve provider parent/child relationships. `active_paths` records
the provider-selected path when one is available, without removing alternative
branches.

A message edit or regenerated response MUST create a new normalized message
blob. The logical message ID remains stable when the provider message identity
remains stable. Earlier revision blobs and manifests remain reachable through
prior import commits.

## IDs

V1 logical IDs use:

```text
historia:<provider>:<source-key>:<kind>:<provider-id>
```

Components are escaped before concatenation. Logical IDs identify provider
entities; Git object IDs identify immutable byte sequences.

## Import receipt

Each import writes one receipt at a deterministic path keyed by archive SHA-256,
importer version, and import profile (`raw` or `normalized`). The receipt contains:

- provider and source key;
- source completeness classification;
- canonical archive digest and optional container digest;
- raw export manifest path;
- importer name and version;
- observation time;
- previous source-ref commit;
- counts of conversations, messages, branches, and generated blobs;
- warnings and skipped material.

If the same receipt path already exists at the source ref, the import is
idempotent and MUST NOT create another commit.

## Completeness classifications

V1 recognizes:

- `full-account-export`: provider-generated account snapshot;
- `conversation-export`: complete export of one conversation;
- `browser-observed`: only content rendered or visited in a browser;
- `cli-native`: content emitted by an installed CLI adapter;
- `user-supplied`: manually supplied content;
- `derived`: summaries, tags, projections, or other generated artifacts.

Absence from a partial source MUST NOT be interpreted as deletion.

## Security and limits

Importers MUST:

- reject absolute paths, parent traversal, NUL bytes, and symbolic links in
  archives;
- impose configurable file-count, total-byte, and JSON-size limits;
- avoid reading browser cookies, access tokens, or local-storage credentials;
- treat page and content-script messages as untrusted input;
- validate Git refs and paths before invoking Git plumbing;
- preserve atomic ref updates when multiple collectors write concurrently.

The default vault is local and has no configured remote. Remote synchronization
is an explicit user action.

## Deletion semantics

A normal removal commit hides content from the current ref but does not erase
historical objects. A purge requires ref rewriting, reflog expiration, garbage
collection, and equivalent action on every configured remote or clone. User
interfaces MUST distinguish hiding, redaction, and purge.

## Rebuildable projections

SQLite chat search, embeddings, summaries, tags, and context bundles are derived
projections. They are not authoritative. Deleting a projection and rebuilding it
from source refs MUST recover equivalent normalized records and provenance.

## V1 commands

```text
historia vault init
historia vault verify
historia chat inspect-openai <export>
historia chat import-openai <export>
historia collect import-openai <export>
```

The OpenAI importer accepts an export ZIP, an extracted export directory, a
`conversations.json` file, or numbered conversation JSON files. It preserves
raw files by default and can disable exact raw-file copying while retaining raw
message and conversation records plus the export manifest.
