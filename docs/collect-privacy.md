# Historia for ChatGPT privacy and data handling

Historia for ChatGPT is a metadata-only browser companion for the local Historia
conversation vault. It does not scrape ChatGPT conversations or operate a remote
collection service.

## Data stored by the browser companion

After an explicit user action, the extension may store:

- a normalized ChatGPT conversation or shared-link URL;
- the active tab title;
- bookmark notes and tags entered by the user;
- prompt and context templates entered by the user;
- canonical update timestamps and deletion tombstones.

Only `https://chatgpt.com/c/<id>` and `/share/<id>` links are accepted. Query
strings and fragments are removed.

## Data the extension does not read

The extension does not read:

- user or assistant message text;
- code blocks, attachments, images, or hidden page state;
- browser cookies, ChatGPT access tokens, authorization headers, passwords, or
  browser storage credentials;
- private or undocumented provider endpoints;
- unrelated tabs or background browsing history.

The manifest has no ChatGPT host permissions and no content script.

## Official history import

Full history is imported from an official ChatGPT export ZIP, extracted
directory, or `conversations.json` selected by the user. The local Historia
application validates and commits the import into a bare Git vault. A local
SQLite index is a rebuildable projection for search and context retrieval.

The vault has no remote by default. Adding a Git remote, pushing refs, exporting
a context package, or copying the vault is a separate user-controlled action.

## Native messaging

The extension may connect to:

```text
ai.greenways.historia_collect
```

for local status and Historia application transport. The native host is
restricted to Historia's stable extension identity. The companion does not send
ChatGPT page content over this channel.

## Browser metadata sync

Browser sync is disabled by default. When enabled, only bounded companion
metadata is written to `storage.sync`. The state is split into digest-verified
chunks below browser per-item quotas.

The sync boundary excludes:

- conversation bodies and official export files;
- Git objects and SQLite indexes;
- browser cookies and ChatGPT tokens;
- API keys, passwords, private keys, authorization values, and bearer tokens.

A portable `historia.chatgpt.sync/0-alpha` JSON envelope is also supported. Imports
merge deterministically by update timestamp and preserve deletion tombstones.

## Prompt handoff

Saved prompts can be copied and ChatGPT can be opened. The extension never
inserts text into ChatGPT and never submits a prompt automatically. The user
reviews and pastes copied material deliberately.

## Firefox consent category

Firefox 140 and newer classify the explicit active-tab URL/title lookup under:

```text
browsingActivity
```

The extension does not declare `personalCommunications` or `websiteContent`
collection because it does not read conversation messages or page content.

## Retention and deletion

Deleting a bookmark or prompt creates a tombstone so the deletion propagates to
opted-in browser profiles. Disabling browser sync stops future writes; browser
account controls govern retained sync data.

Git history is deliberately durable. Historia distinguishes:

- **hide**: exclude content from ordinary retrieval;
- **redact**: create a safer derived view while retaining the source record;
- **purge**: rewrite affected refs, expire reflogs, run Git garbage collection,
  and repeat the operation for every configured remote or clone.

Removing the extension or native-host registration does not delete the Git vault
or SQLite projection.

## Source transparency

The packaged browser disclosure is `extension/src/privacy.html`. Manifest and
bundle policy are covered by `test/collect-extension-policy.test.js`,
`test/collect-extension-bundle.test.js`, and
`test/chatgpt-companion.test.js`.
