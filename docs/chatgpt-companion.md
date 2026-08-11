# Historia for ChatGPT

Historia for ChatGPT is the browser-facing companion for the local Historia conversation vault.

It deliberately separates two data paths:

```text
ChatGPT web app
  └── explicit URL/title bookmark + user-authored prompts
          └── local extension state
              └── optional browser metadata sync

Official ChatGPT export ZIP / conversations.json
  └── explicit Historia import
          └── Git-native local vault
              └── rebuildable SQLite search and context index
```

The extension does not scrape conversation messages, read browser cookies, call undocumented ChatGPT endpoints, insert text into ChatGPT, or submit prompts. Full conversation history is imported from the official export selected by the user.

## Companion workflow

1. Open a ChatGPT conversation or shared link.
2. Choose the Historia extension action.
3. Save the normalized URL and title as a bookmark.
4. Open the full companion to search bookmarks and manage reusable prompt/context templates.
5. Copy a prompt, open ChatGPT, review it, and paste it manually.
6. Open **Import history** to add an official export to the local Historia vault.
7. Use Archive, Context, Ledger, and Settings in the local Historia application.

## Sync boundary

Browser sync is opt-in and contains only bounded companion metadata:

- bookmark URLs, titles, notes, and tags;
- user-authored prompt templates and tags;
- canonical timestamps and deletion tombstones.

It excludes conversation bodies, export files, Git objects, SQLite indexes, API keys, browser cookies, ChatGPT tokens, and private keys.

The companion also supports a portable `historia.chatgpt.sync/0-alpha` JSON envelope. Imports merge records deterministically by update timestamp and retain tombstones.

## Local archive

Request an official ChatGPT export, then use the Historia application:

```bash
historia vault init
historia chat inspect-openai ~/Downloads/chatgpt-export.zip
historia chat import-openai ~/Downloads/chatgpt-export.zip
historia chat index
```

Or start the local application:

```bash
historia collect serve
```

Then open:

```text
http://127.0.0.1:4319/#collect
```

## Permissions

The extension requests:

```text
nativeMessaging
storage
tabs
```

`tabs` is used only to read the active tab's URL and title after an explicit extension interaction and to open reviewed destinations. There are no ChatGPT host permissions and no content scripts.

`nativeMessaging` is used only for local Historia status and transport. The extension does not transmit ChatGPT page content.
