# Chat search and context retrieval

Historia builds a rebuildable SQLite projection over conversation source refs.
Git remains authoritative: search rows point back to source refs, archive commits,
conversation manifests, logical message identities, immutable revision OIDs, and
message object paths.

## Build or refresh the index

```bash
historia chat index
```

Indexing is incremental. Historia follows each configured source ref, processes
newly reachable archive commits, stores immutable message revisions once, and
advances a checkpoint only after the corresponding SQLite transaction commits.

Rebuild the complete projection when needed:

```bash
historia chat index --rebuild
```

Deleting or rebuilding SQLite does not remove Git content.

## Search current messages

```bash
historia chat search "signed rooms"
```

By default, results use the most recently observed revision of each logical
message. This avoids returning every earlier edit when the user is asking about
the current state of a conversation.

Search historical revisions explicitly:

```bash
historia chat search "earlier architecture" --historical
```

Common filters include:

```bash
historia chat search "agent keys" \
  --role user \
  --role assistant \
  --source openai \
  --since 2026-07-01 \
  --until 2026-08-01 \
  --limit 20
```

Provider timestamps and Historia observation/import timestamps are separate.
Time filters operate on the fields documented by the command output rather than
silently treating Git commit time as provider message time.

## Build a context package

```bash
historia context build \
  "Hestia keys, private rooms and ledger signing" \
  --budget 12000 \
  --max-conversations 8 \
  --radius 2 \
  --include-branches \
  --format markdown \
  --output /tmp/historia-context.md
```

The builder:

1. searches current or historical message revisions;
2. groups candidates by the exact conversation snapshot that supplied them;
3. expands a bounded graph radius around relevant messages;
4. prefers the provider-selected active path;
5. includes alternate branches only when requested;
6. deduplicates immutable message revisions;
7. packs content beneath the selected token estimate;
8. emits stable Historia citations and a provenance appendix.

JSON output is available for programmatic consumers:

```bash
historia context build "query" --format json
```

## Provenance model

A selected message can be resolved through:

```text
source ref
  → archive commit
  → conversation manifest path
  → logical message identity
  → immutable revision OID
  → normalized message object path
  → raw provider record OID
```

Search and context output should therefore support claims such as:

> The user discussed private agent rooms in this imported conversation snapshot,
> at this source ref and archive commit, in this exact message revision.

This is stronger and more useful than treating retrieved text as an unattributed
memory fragment.

## Branch-aware retrieval

Conversation history is a graph, not a flat transcript. Edited messages,
regenerated assistant responses, and alternate paths remain represented by
separate immutable revisions and graph edges.

The active path records the provider-selected route when one exists. It does not
delete or invalidate alternate branches. Context generation can stay on the
active path for concise current context or include branches for design-history,
decision-analysis, and disagreement review.

## Source completeness

Retrieval results retain the source classification:

- `full-account-export`
- `conversation-export`
- `browser-observed`
- `cli-native`
- `user-supplied`
- `derived`

Absence from a partial source, especially `browser-observed`, must not be
interpreted as deletion.

## Agent use

Install the portable skill:

```bash
historia agent install codex
historia agent install kimi
```

The skill instructs an agent to refresh the index, use the narrowest query,
expand only bounded relevant context, preserve citation labels, distinguish
current from historical revisions, and report missing analysis rather than
inventing history.

Installing the skill does not bulk-import the private archive into an agent's
own session database. The agent retrieves selected Historia context on demand.

## Deterministic core

The core retrieval path uses Git and SQLite FTS5. It does not require:

- an LLM call;
- an MCP server;
- an embedding provider;
- Qdrant or another remote vector database;
- an external synchronization service.

Optional adapters can be layered on later without changing the Git archive or
SQLite provenance contracts.
