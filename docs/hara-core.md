# Historia Hara Core

Status: Draft implementation specification

## Purpose

Historia is a Hara application. The root `project.edn` is the authoritative
application definition. JavaScript, Python, Clojure/Babashka and Hara analysers
are isolated workers that Historia coordinates through a deterministic protocol;
they are not competing application runtimes.

The core is intentionally small. It owns only stable domain contracts and the
order in which data passes through them. GitHub synchronization, SQLite,
long-lived worker supervision, chat import, graph construction and browser
collection are added as vertical slices after these contracts settle.

## Core boundaries

### Artifacts

An artifact is one immutable observed revision of a provider-owned object.
Initial artifact kinds include GitHub issues, repository files and chat
messages. Every artifact contains:

```text
schema
id
kind
source
revision
blocks
```

A block is the smallest source unit handed to an analyser or linker. The alpha
core preserves title and Markdown body blocks for a GitHub issue. Paragraph,
list, task, sentence and code-fence subdivision is a later deterministic
projection and must retain exact source anchors.

Artifact IDs identify logical provider objects. Revisions identify observations
of those objects. An issue can therefore keep one logical artifact ID while
acquiring multiple immutable revisions.

### Providers

A provider observes external state and normalizes it into artifacts. Provider
adapters do not write directly into an index and do not infer relationships.

The first pure adapter is `historia.provider.github/issue`. It accepts an
already-observed issue map and produces a provider-neutral artifact. Network
access, authentication, pagination and synchronization are intentionally outside
the first slice.

GitHub writes are disabled in the core descriptor. Any later writeback is an
explicit reviewed effect, separate from indexing.

### Analysers

The existing workers remain beneath `analyzers/`:

```text
analyzers/typescript
analyzers/python
analyzers/clojure
analyzers/hara
```

`historia.core.analyzer` provides deterministic language dispatch and the shared
JSONL `analyze` request envelope. Unknown languages return `nil`; Historia must
not guess an analyser.

The first slice describes commands but does not start workers. A later Hara
broker owns process lifecycle, timeouts, request ordering, fingerprints and
content-addressed caching.

### Indexes

`historia.core.index` is a pure in-memory reference implementation. It stores
three independent record families by stable ID:

```text
artifacts
analyses
links
```

The in-memory implementation is deliberately not durable or authoritative. It
exists so provider, analyser and linker contracts can be tested before those
contracts are coupled to a SQLite schema.

A later SQLite adapter must preserve the same logical operations and remain
fully rebuildable from authoritative Git/provider records.

## Pipeline

The alpha pipeline is:

```text
provider.observe
artifact.normalize
analysis.dispatch
index.write
link.project
```

The first implementation exposes this order through `historia core describe`
and `historia.core/ingest-plan`. The stages are contracts, not a claim that all
effects are implemented.

## Migration boundary

The current Bun/JavaScript application remains a temporary parity oracle. Its
code under `src/`, `test/`, `apps/`, `extension/` and related package tooling is
not the architectural root of the new system.

Migration follows these rules:

1. Add one dependency-complete Hara slice.
2. Commit parity fixtures for behavior being retained.
3. Route the supported command through Hara.
4. Keep the legacy command only while it remains a useful oracle.
5. Move or delete legacy files only after parity is demonstrated.

The repository should eventually place retired runtime material under
`legacy/bun`, but the first core slice performs no broad file moves. Preserving a
working baseline is more important than making the tree appear finished.

## Next slices

1. Add a Hara-owned persistent analyser broker.
2. Split Markdown into anchored paragraphs, lists, tasks and code fences.
3. Import GitHub repositories, issues and comments as immutable observations.
4. Add a SQLite implementation behind the core index operations.
5. Build explainable chat/code/issue link candidates without requiring an LLM.
6. Add durable accepted and rejected link assertions.
7. Port archive, retrieval, context and collection features into the stable
   core one vertical slice at a time.
