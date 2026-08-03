# Historia Collect browser extension

This directory contains the unpacked Manifest V3 extension for explicit local
capture of rendered ChatGPT conversations.

- `src/content.js` extracts semantic message blocks from the current page.
- `src/background.js` owns the native-messaging connection and serializes writes.
- `src/popup.*` provides one-click manual collection.
- `src/options.*` manages the private source key and opt-in automatic collection.

The extension never writes the Git vault directly. It sends a bounded
`historia.collect.browser-observation/v1` document to
`ai.greenways.historia_collect`, where the native host validates and archives
it.

See `docs/browser-collect.md` for host installation and use.
