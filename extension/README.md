# Historia Collect browser extension

This directory contains the unpacked Manifest V3 extension for explicit local
capture of rendered ChatGPT conversations.

- `src/content.js` extracts semantic message blocks from the current page.
- `src/background.js` owns the native-messaging connection and serializes writes.
- `src/popup.*` provides one-click manual collection and connection checks.
- `src/options.*` manages the private source key and opt-in automatic collection.

The extension never writes the Git vault directly. It sends a bounded
`historia.collect.browser-observation/v1` document to
`ai.greenways.historia_collect`, where the native host validates and archives
it.

## Install the local bridge

```bash
historia-collect install --browser chrome
```

The installer reports this directory as the unpacked extension source and
registers the native host at user scope. It supports Chrome, Chromium, Brave,
Microsoft Edge, and Firefox.

The committed public manifest key gives Chromium-family browsers the stable ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses the declared identity:

```text
historia-collect@greenways.ai
```

Run a post-install diagnostic with:

```bash
historia-collect doctor --browser chrome
```

See `docs/collect-install.md` for complete installation details and
`docs/browser-collect.md` for collection behavior and the security boundary.
