# Historia Collect local application

Historia Collect is a loopback-only application for importing, browsing, and
retrieving private conversation history from a Historia vault. It is served by
the installed `historia` executable and does not require a cloud service.

## Start the application

```bash
historia collect serve
```

The default address is `http://127.0.0.1:4319/`. Override the loopback bind
address, port, vault, or derived SQLite index when necessary:

```bash
historia collect serve \
  --host 127.0.0.1 \
  --port 4319 \
  --vault ~/.local/share/historia/vault.git \
  --database ~/.local/share/historia/chat.sqlite
```

Historia accepts only `127.0.0.1`, `localhost`, or `::1` as application bind
addresses. The local application is not intended to be exposed to another
machine or directly to a public network.

## Application areas

### Collect

The Collect view accepts official ChatGPT ZIP or JSON exports. An import writes
one atomic Git transaction, updates the source ref with compare-and-swap
semantics, and incrementally updates the local chat index. Re-importing the same
archive and importer profile is idempotent.

The view also reports the current number of conversations, logical messages,
immutable message revisions, and archive commits, grouped by collection source.

### Archive

The Archive view searches SQLite FTS projections and resolves each result back
to an exact source ref, Git commit, conversation manifest, logical message, and
immutable revision OID. Selecting a result opens the conversation snapshot at
the commit that supplied the match rather than silently substituting the latest
version.

Messages on the provider-selected path are distinguished from regenerated or
otherwise alternate branches. Full message content remains in Git; SQLite is a
rebuildable query projection.

### Context

The Context view retrieves matching messages, expands bounded conversation
windows, optionally includes alternate branches, deduplicates revisions, and
packs the result under a user-selected token estimate. The resulting Markdown
contains stable Historia citation labels and a provenance section suitable for
passing into CLI agents.

### Ledger

The Ledger view exposes archive commits, parent links, timestamps, source refs,
transaction messages, and import receipt counts. One commit represents one
collection transaction, not one message.

### Settings

Settings shows the active vault and SQLite paths, runs Git integrity checks, and
can delete and rebuild the derived index without changing the authoritative Git
archive.

## Local security boundary

The application implements the following baseline controls:

- it binds to `127.0.0.1` by default;
- it rejects unrecognized Host headers;
- a random per-process session token protects every state-reading or mutating
  API route;
- responses disable framing, caching, referrer disclosure, and external script,
  image, and connection origins through Content Security Policy;
- uploaded exports are copied into an owner-only temporary directory and removed
  after the import transaction;
- no remote is configured and no telemetry is emitted by the core application.

The session bootstrap endpoint is same-origin and does not opt into cross-origin
browser access. The token is held in memory by the application page and expires
when the local Historia process stops.

## Derived data

The application reads from the SQLite chat index for speed. Use the Settings
view or the CLI to rebuild it from Git:

```bash
historia chat index --rebuild
```

Equivalent source refs and importer outputs must produce an equivalent index.
Git objects, manifests, and import receipts remain authoritative.
