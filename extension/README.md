# Historia for ChatGPT extension

This directory contains the unpacked Manifest V3 companion for explicit interaction between the ChatGPT web app and a local Historia archive.

The browser app remains a thin client. The separately installed `ai.greenways.historia_collect` Native Messaging host owns Git-vault and SQLite operations on the same computer.

## What it does

- bookmarks the active ChatGPT conversation using its reviewed URL and title only;
- stores reusable prompts and tombstones in a bounded browser projection;
- searches the local Historia SQLite index and returns Git commit provenance;
- builds bounded Markdown context from archived conversations;
- imports an official ChatGPT export from an explicit absolute local path;
- pulls and pushes companion bookmarks and prompts through a dedicated Historia Git ref; and
- opens ChatGPT after copying context for deliberate review and paste.

The extension does **not** scrape rendered messages, read cookies or session tokens, call private ChatGPT APIs, inspect ChatGPT local storage, or submit prompts automatically.

## Install the local bridge

```bash
historia-collect install --browser chrome
historia-collect doctor --browser chrome
```

The installer reports the checksum-verified unpacked extension directory and registers the native host at user scope. It supports Chrome, Chromium, Brave, Microsoft Edge, and Firefox.

The committed public manifest key gives Chromium-family browsers the stable ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses:

```text
historia-collect@greenways.ai
```

## Native provider operations

The background service worker exposes a closed mapping to these native operations:

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

The browser cannot choose arbitrary native operations. Search results and context are bounded below Chrome's 1 MB native-host response limit.

### Durable metadata sync

Bookmarks, prompt templates, and tombstones can be synchronized to:

```text
refs/historia/companion/chatgpt
```

in the local bare Git vault. Pushes carry the last observed head. If another device has advanced the ref, the host deterministically merges records and commits the merged result rather than overwriting either side.

Browser profile sync remains an optional convenience projection. Conversation bodies and Git objects are never placed into browser profile sync.

### Official export import

The companion accepts an explicit absolute path to a ChatGPT export ZIP, extracted directory, or `conversations.json` file on the native host's computer. The browser does not gain general filesystem access; it sends only the path typed by the user to the reviewed import operation.

For large or scripted imports, use:

```bash
historia chat import-openai /absolute/path/to/chatgpt-export.zip
```

## Permissions

The extension requests only:

```text
nativeMessaging
storage
tabs
```

It has no ChatGPT host permission and installs no content script. The `tabs` permission is used to read the URL and title of the active tab after an explicit bookmark action and to open reviewed destinations.

See:

- `docs/collect-install.md` for browser registration;
- `docs/chat-retrieval.md` for search and context construction;
- `docs/collect-privacy.md` for local data and retention boundaries; and
- `extension/src/privacy.html` for the browser-facing disclosure.
