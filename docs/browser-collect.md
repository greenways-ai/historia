# Browser collection with Historia Collect

Historia Collect includes a local native-messaging host and a Manifest V3
browser extension. The extension observes only the ChatGPT conversation
currently rendered in the tab. It does not read cookies, access tokens, browser
storage credentials, or undocumented provider APIs.

Browser captures are deliberately classified as `browser-observed`. They are
useful for collecting new work between official account exports, but they are
not treated as complete provider snapshots or proof of provider authorship.

Read [Historia Collect privacy and data handling](collect-privacy.md) for the
complete list of observed fields, excluded credentials, local transfer,
automatic collection, and Git retention semantics.

## Install the browser bridge

Install the native host for the browser you use:

```bash
historia-collect install --browser chrome
```

Configure more than one browser by repeating `--browser`:

```bash
historia-collect install \
  --browser chrome \
  --browser firefox
```

Supported browsers are Chrome, Chromium, Brave, Microsoft Edge, and Firefox 140
or newer. The installer:

- resolves a compiled native host or creates an absolute-Bun launcher on macOS
  and Linux;
- writes the browser's user-scoped native-messaging manifest;
- registers the manifest in the current-user registry on Windows;
- restricts the manifest to Historia Collect's stable extension identity;
- verifies the manifest, host executable, extension allowlist, and extension
  source directory;
- reports the exact unpacked extension directory and browser extension page.

See [Installing Historia Collect](collect-install.md) for platform paths,
advanced options, Windows behavior, and uninstall instructions.

## Stable extension identity

The extension carries a public manifest key, giving Chromium-family browsers the
stable extension ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses:

```text
historia-collect@greenways.ai
```

This allows the native host to be registered before loading the unpacked
extension and prevents unrelated extensions from invoking the host.

## Load the extension

Open the extension page reported by `historia-collect install`, enable developer
mode where required, and load the reported `extension/` directory.

Firefox 140 or newer presents built-in consent for the declared categories
`browsingActivity`, `personalCommunications`, and `websiteContent`. In Historia
Collect these describe the current ChatGPT page identity, rendered chat
messages, and visible page content transferred to the local native host—not a
Greenways cloud service.

Open the Historia Collect popup and select **Check connection**. The ping crosses
the browser native-messaging boundary and confirms that the extension identity,
manifest, executable, and host protocol are aligned.

Manual collection is the default:

1. Open a ChatGPT conversation.
2. Review the local-transfer disclosure in the popup.
3. Select **Collect this conversation**.
4. The content script extracts rendered messages and sends a normalized,
   bounded observation to the extension background context.
5. The background context forwards it to the local native host.
6. The host validates the observation, commits it to a dedicated
   `refs/historia/sources/openai-browser/*` ref, and refreshes the SQLite index.

Automatic collection can be enabled explicitly in the extension settings. It
is disabled by default and debounced after rendered message changes. Exact
content duplicates are idempotent even when they are observed at different
times.

## Diagnose the bridge

```bash
historia-collect doctor --browser chrome
```

The command exits non-zero when the manifest is missing, the host cannot be
executed, the extension allowlist is wrong, or the Windows registry entry is
absent.

The extension popup's connection check additionally verifies a live native-host
round trip.

## Build the native host from source

The npm package exposes `historia-collect-host`. A self-contained executable can
also be built with Bun:

```bash
bun run build:collect-host-binary
```

Install it explicitly when another packaging system controls executable paths:

```bash
historia-collect install \
  --browser chrome \
  --host-path /absolute/path/to/historia-collect-host
```

The host communicates over the browser native-messaging framing protocol and
writes to the same local Git vault and SQLite projection as the normal Historia
CLI. Standard output is reserved for protocol frames; diagnostics go to
standard error.

## Lower-level manifest generation

Packaging systems can generate a manifest without installing it:

```bash
historia collect native-manifest \
  --browser chrome \
  --extension-id idfjphfgkpmmgggnbomlalheckgdcefj \
  --host-path /absolute/path/to/historia-collect-host \
  --output /tmp/ai.greenways.historia_collect.json
```

For Firefox, pass `--browser firefox` and
`historia-collect@greenways.ai` as the extension identity.

For an additional host-side allowlist, set a comma-separated list of exact
origins:

```bash
export HISTORIA_COLLECT_ALLOWED_ORIGINS='chrome-extension://idfjphfgkpmmgggnbomlalheckgdcefj/'
```

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

The extension requests only `nativeMessaging`, `storage`, and `tabs`, plus
content-script access to the declared ChatGPT origins. It contains no analytics,
advertising, telemetry, cloud upload, or third-party tracking SDK.

Rendered DOM collection is necessarily provider-UI dependent. A later official
account export can be imported alongside browser observations and reconciled by
logical provider IDs without discarding either provenance trail.
