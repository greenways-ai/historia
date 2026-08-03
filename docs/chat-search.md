# Searching and retrieving conversation history

Historia builds a local SQLite projection from the authoritative Git vault. The
index can be removed and recreated at any time; normalized messages, raw source
records, import receipts, and observation history remain in Git.

## Build or update the index

```bash
historia chat index
```

The default database is `chat-index.sqlite` beside the platform-specific
`vault.git`. Override it with `HISTORIA_INDEX` or `--database`.

```bash
historia chat index \
  --vault ~/historia/vault.git \
  --database ~/historia/chat-index.sqlite
```

Indexing is incremental by source ref. If a tracked ref has been rewritten or
removed, Historia rebuilds the projection from all current
`refs/historia/sources/*` refs. Use `--rebuild` to request that explicitly.

```bash
historia chat index --rebuild
```

`chat import-openai`, `collect import-openai`, `chat search`, `chat list`,
`chat show`, and `context build` update the index automatically. Pass
`--no-index` when a caller needs to control that step itself.

## Search messages

```bash
historia chat search "signed Hestia rooms"
```

Results contain the logical message and conversation identifiers, message
revision OID, source ref, archive commit, import archive digest, timestamps, and
manifest path. By default Historia returns only the latest observed revision of
each logical message. Use `--historical` to search superseded revisions as well.

Useful filters include:

```bash
historia chat search "agent keys" \
  --role assistant \
  --since 2026-07-01 \
  --source-ref refs/historia/sources/openai/<source>

historia chat search "earlier wording" --historical
```

List the latest observation of every conversation:

```bash
historia chat list --limit 100
```

Read one current or historical conversation snapshot:

```bash
historia chat show historia:openai:<source>:conversation:<id>
historia chat show historia:openai:<source>:conversation:<id> --commit <oid>
```

Conversation output preserves active-path positions and alternate branch nodes.

## Build bounded context for an agent

```bash
historia context build "Hestia rooms, keys and ledger signing" \
  --budget 12000 \
  --max-conversations 8 \
  --radius 2 \
  --format markdown \
  --output /tmp/hestia-context.md
```

Context selection is deterministic:

1. SQLite FTS5 retrieves message revisions.
2. Each hit is resolved to an observed conversation snapshot.
3. Historia includes a bounded window around active-path hits and direct graph
   neighbors for branch hits.
4. Duplicate revisions are removed.
5. Messages are packed within the requested approximate token budget.

Use `--include-branches` to pull direct branch neighbors around selected
messages. Use `--historical` when the context should be allowed to start from a
superseded message revision rather than the latest observed state. JSON output
follows `historia.chat.context-bundle/v1`; Markdown output
contains `[H1]`, `[H2]`, and similar citations with a provenance section mapping
each excerpt to its message revision, source ref, and archive commit.

The token estimator is deliberately local and provider-independent: UTF-8 byte
length divided by four. It is a packing bound, not a claim about the exact token
count of a particular model tokenizer.

## Browser-observed sources

Native browser captures use their own `refs/historia/sources/openai-browser/*`
refs but enter the same temporal index. Search results preserve the browser
source ref and exact capture commit, so they can be filtered or compared with
full account exports without collapsing their different completeness claims.

## Install the retrieval skill in a CLI agent

Historia packages a shell-backed `historia-chat-agent` skill. Install it without
manually locating package files:

```bash
historia agent install codex
historia agent install kimi
```

Use `--scope project` to install under `.codex/skills/` or
`.kimi-code/skills/` in the current project instead of the user's shared skill
directory. The skill retrieves bounded context through the local CLI and does
not require an MCP server.
