---
name: historia-chat-agent
description: Use when an agent needs private historical conversation context, chat search, a prior decision, or provenance from a local Historia vault.
---

# Historia Chat Agent

Historia keeps conversation content and observation history in a local bare Git
vault. SQLite is a rebuildable retrieval projection. Never infer that the index
is the authoritative archive, and never rewrite provider or CLI history stores
directly.

## Workflow

Refresh the projection before retrieval unless the caller explicitly requires a
no-update operation:

```bash
historia chat index
```

Use the narrowest command that answers the task:

```bash
historia chat search "query terms"
historia chat list --limit 50
historia chat show <conversation-hid>
historia context build "query terms" --budget 12000 --format markdown
historia collect status
```

When exact query wording may differ from the archived wording, build the
rebuildable graph/topic projection and use one-hop topic expansion:

```bash
historia graph index
historia topic search "query terms"
historia context build "query terms" \
  --expand-topics \
  --budget 12000 \
  --format markdown
```

Topic edges mean "potentially related for retrieval," not verified semantic
identity. Always interpret the original selected messages and preserve their
Historia citations. Distinguish direct topic matches from associated-topic
matches when explaining why context was selected.

For a file that another CLI can read:

```bash
historia context build "query terms" \
  --expand-topics \
  --budget 12000 \
  --max-conversations 8 \
  --radius 2 \
  --format markdown \
  --output /tmp/historia-context.md
```

Use `--source-ref`, repeated `--role`, `--since`, and `--until` to constrain a
retrieval. Use `--historical` only when superseded message revisions are
relevant. Use `--include-branches` only when regenerated or alternate responses
are relevant.

Bound topic expansion with `--topic-seed-limit`, `--topic-limit`, and
`--topic-min-support` when a broad archive produces too many lateral matches.
Prefer ordinary lexical retrieval for exact identifiers, commit hashes, quoted
phrases, and paths. Prefer topic expansion for design themes, renamed concepts,
and related discussions whose wording may differ.

## Reporting

- Cite Historia context markers such as `[H1]` when they are present.
- Preserve the associated message HID, revision OID, source ref, and Git commit
  in detailed reports.
- Distinguish provider time, observation time, and Git archive commit time.
- Treat browser-observed records as observations, not provider attestations.
- Treat an older message revision as historical evidence rather than the current
  provider state.
- Treat associated topics as retrieval evidence, not as claims made by the user.
- Report an empty retrieval instead of fabricating prior conversations.

## Privacy

Do not upload the vault, SQLite index, context bundle, or attachments to a remote
service unless the user explicitly requests that transfer. Build the smallest
context bundle that supports the task, and honor any redaction policy supplied
by the caller.

## Installation

Install the packaged skill through Historia:

```bash
historia agent install codex
historia agent install kimi
```

Use `--scope project` to place it under `.codex/skills/` or
`.kimi-code/skills/` in the current repository. The default is the agent's
shared user skill directory. For another CLI agent, place this skill directory
in that agent's supported project or user location. The commands remain ordinary
local shell commands and do not require MCP.
