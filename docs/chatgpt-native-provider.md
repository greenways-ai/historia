# Historia for ChatGPT native provider

The Historia for ChatGPT browser companion is a thin client of the existing `ai.greenways.historia_collect` Native Messaging host. The native provider owns filesystem, Git-vault, and SQLite access on the same computer; the extension never receives general filesystem or shell authority.

## Install or upgrade

The browser companion and native provider are shipped together by the existing Collect installer:

```bash
historia-collect install --browser chrome
historia-collect doctor --browser chrome
```

Rerun `install` after upgrading Historia so the checksum-verified unpacked extension and native-host executable are materialized from the same release. Reload the extension from the browser's extension manager after installation. Chromium-family browsers retain the committed extension ID; Firefox retains `historia-collect@greenways.ai`.

## Operations

The provider protocol is `historia.native-provider/0-alpha` and exposes a closed operation vocabulary:

```text
history/status
history/list
history/search
history/conversation
history/import-export
history/sync-status
history/sync-pull
history/sync-push
context/build
```

The existing `ping`, `status`, and legacy explicit `capture` operations remain compatible with the `1.0` Native Messaging frame protocol. `status` aliases `history/status`.

## History and context

`history/search` queries the rebuildable SQLite index and returns bounded message previews with source ref, commit OID, archive digest, and object paths. It does not return raw export files or unbounded message bodies.

`history/conversation` retrieves one archived snapshot with configurable message and content limits.

`context/build` uses Historia's existing token-aware context builder. The native surface limits the request to 40,000 estimated tokens and keeps the encoded response below Chrome's 1 MB native-host-to-extension boundary. The default result is Markdown with Historia citations; callers may explicitly request the structured bundle.

## Official ChatGPT export import

`history/import-export` accepts an explicit absolute local path to a ChatGPT export ZIP, extracted directory, or `conversations.json`. It invokes the existing OpenAI export archiver and incrementally refreshes the SQLite projection.

The browser does not discover paths or scan folders. A user either types the path in the companion or invokes the standalone CLI:

```bash
historia chat import-openai /absolute/path/to/chatgpt-export.zip
```

## Companion metadata ref

Bookmarks, prompt templates, tags, notes, timestamps, and tombstones are stored under:

```text
refs/historia/companion/chatgpt
```

The current state is:

```text
companion/chatgpt/state.json
```

Each non-idempotent push also adds a sync receipt under `companion/chatgpt/receipts/`.

The state envelope binds a SHA-256 digest of the canonical `historia.chatgpt.companion-state/0-alpha` value. Pull verifies the digest before returning state. Push validates the complete state, rejects secret-shaped fields through the companion schema, and commits with an expected-old Git OID.

If the caller's `expected_head` is stale, the provider deterministically merges both states and records `conflict_merged: true` rather than silently overwriting either side. Deletion tombstones participate in the same merge.

## Browser projection

The browser keeps a bounded IndexedDB/local-storage projection for fast UI startup. Explicit pull and push operations reconcile that projection with the Git ref. Browser profile sync remains optional and contains metadata only; it is not the durable Historia authority.

## Privacy boundary

The companion does not:

- inject a content script into ChatGPT;
- read cookies, access tokens, authorization headers, or ChatGPT browser storage;
- call undocumented ChatGPT endpoints;
- automatically extract rendered conversations;
- automatically submit prompts; or
- expose arbitrary native operation, filesystem, Git, or shell calls.

Conversation text reaches the companion only after an explicit local history search, conversation retrieval, or context-build request.
