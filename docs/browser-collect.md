# Browser collection with Historia Collect

Historia Collect includes a local native-messaging host and an unpacked
Manifest V3 browser extension. The extension observes only the ChatGPT
conversation currently rendered in the tab. It does not read cookies, access
tokens, browser storage, or undocumented provider APIs.

Browser captures are deliberately classified as `browser-observed`. They are
useful for collecting new work between official account exports, but they are
not treated as complete provider snapshots or proof of provider authorship.

## Build or install the native host

The npm package exposes `historia-collect-host`. A self-contained executable can
also be built with Bun:

```bash
bun run build:collect-host-binary
```

The host communicates over the browser native-messaging framing protocol and
writes to the same local Git vault and SQLite projection as the normal Historia
CLI. Standard output is reserved for protocol frames; diagnostics go to
standard error.

## Register the host

Generate a browser-specific native host manifest:

```bash
historia collect native-manifest \
  --browser chrome \
  --extension-id <32-character-extension-id> \
  --host-path /absolute/path/to/historia-collect-host \
  --output /tmp/ai.greenways.historia_collect.json
```

For Firefox, pass `--browser firefox` and the declared extension identity
`historia-collect@greenways.ai`.
Install the generated manifest in the browser's platform-specific native
messaging host directory. The manifest permits only the supplied extension
identity.

For an additional host-side allowlist, set a comma-separated list of exact
origins:

```bash
export HISTORIA_COLLECT_ALLOWED_ORIGINS='chrome-extension://<extension-id>/'
```

## Load the extension

Load the repository's `extension/` directory as an unpacked extension. Its
Manifest V3 background declaration includes both the Chromium service worker and
the Firefox event-page fallback. Open its
settings and choose a stable private source key for the browser profile. The key
is hashed before it appears in Git refs or tree paths.

Manual collection is the default:

1. Open a ChatGPT conversation.
2. Select **Collect this conversation** from the extension popup.
3. The content script extracts rendered messages and sends a normalized,
   bounded observation to the extension service worker.
4. The service worker forwards it to the local native host.
5. The host validates the observation, commits it to a dedicated
   `refs/historia/sources/openai-browser/*` ref, and refreshes the SQLite index.

Automatic collection can be enabled explicitly in the extension settings. It
is disabled by default and debounced after rendered message changes. Exact
content duplicates are idempotent even when they are observed at different
times.

## Local testing without the extension

A captured observation can be imported directly:

```bash
historia collect capture-json browser-observation.json
```

The document must conform to
`historia.collect.browser-observation/v1`. Historia enforces message, block,
string, nesting, and total-payload limits; rejects cyclic or dangling parent
relationships; strips URL query strings and fragments; and rejects credential
fields in structured metadata.

## Security boundary

The page and content script are treated as untrusted inputs. The native host:

- accepts only bounded length-prefixed JSON messages;
- validates the protocol version and operation;
- validates and canonicalizes every browser observation;
- accepts only ChatGPT HTTPS page origins in captured metadata;
- rejects credential-shaped metadata fields;
- uses atomic Git ref updates;
- keeps the vault local unless the user separately configures Git remotes.

Rendered DOM collection is necessarily provider-UI dependent. A later official
account export can be imported alongside browser observations and reconciled by
logical provider IDs without discarding either provenance trail.
