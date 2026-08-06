# Browser companion for ChatGPT

Historia's browser extension is a user-controlled companion to ChatGPT and the
local Git-native Historia vault. It does not collect rendered conversation
messages.

The browser surface supports:

- explicit bookmarks for the active ChatGPT conversation or shared link;
- reusable prompt and context templates that are copied for manual review;
- direct links to the local Historia import, archive, context, ledger, and
  settings views;
- optional browser-profile sync for bounded bookmark and prompt metadata; and
- a portable JSON metadata bundle with deterministic merge and tombstones.

Full conversation history is imported from an official ChatGPT export selected
by the user. Historia does not call undocumented ChatGPT endpoints or attempt to
rebuild the provider's native sidebar.

See [Historia for ChatGPT](chatgpt-companion.md) for the product workflow and
[privacy and data handling](collect-privacy.md) for the exact boundary.

## Install the browser bridge

```bash
historia-collect install --browser chrome
```

Configure several browsers by repeating `--browser`:

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
- restricts the manifest to Historia's stable extension identity;
- verifies the manifest, host executable, extension allowlist, and extension
  source directory; and
- reports the exact unpacked extension directory and browser extension page.

## Stable extension identity

Chromium-family browsers derive this stable extension ID from the public
manifest key:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses:

```text
historia-collect@greenways.ai
```

## Permissions and page boundary

The extension requests only:

```text
nativeMessaging
storage
tabs
```

It declares no ChatGPT host permissions and contains no content script.

`tabs` is used after explicit extension interaction to read the active tab's URL
and title and to open reviewed destinations. Only URLs matching
`https://chatgpt.com/c/<id>` or `/share/<id>` can become bookmarks. Query strings
and fragments are removed.

Firefox classifies that explicit URL/title lookup as `browsingActivity`. The
extension does not request `personalCommunications` or `websiteContent` because
it does not read messages or page DOM content.

## Use the companion

1. Open a ChatGPT conversation or shared link.
2. Open the Historia extension action.
3. Choose **Save current chat bookmark**.
4. Open the full companion to filter bookmarks and manage prompts.
5. Use **Copy & open ChatGPT** to place a prompt on the clipboard, then review
   and paste it manually.
6. Use **Import history** to open the official-export import view in the local
   Historia application.

The extension never inserts text or submits a prompt.

## Diagnose the bridge

```bash
historia-collect doctor --browser chrome
```

A successful diagnostic confirms the native manifest, executable, stable
extension identity, and embedded extension checksums. The local native host is
used for status and local Historia transport, not page-content extraction.

## Security boundary

- no ChatGPT content script or host permission;
- no cookies, access tokens, authentication headers, or browser credential
  storage;
- no private or undocumented ChatGPT API calls;
- no automatic collection;
- no automatic prompt insertion or submission;
- browser sync is opt-in and metadata-only;
- full history remains in the local Git vault and enters through explicit export
  import;
- the vault has no remote unless the user separately configures one.
