# Historia Core

`greenways/historia-core` is the capability-free Hara package at the centre of
Historia. It defines the portable records that let applications preserve
original provider documents before deriving artifacts, analyses, indexes, and
graphs.

The package contains:

- content-addressed blob references, immutable source documents, and exact
  source anchors;
- provider descriptors, a pure provider registry, and provider request/result
  envelopes;
- provider-neutral artifact, block, analysis, and link records;
- portable analyser-family descriptors and the canonical analyser request
  envelope;
- the pure rebuildable in-memory index contract.

It does not contain the Historia executable, Git vault, provider network or
browser access, credentials, worker commands, process supervision, Bun, Python,
Babashka, or another runtime. A consuming application decides how providers and
analyser descriptors are connected to local, remote, browser, or sandboxed
executors.

This keeps the boundary explicit:

```text
historia-core contracts
  -> Historia runtime capabilities
  -> Greenways Intel graph and retrieval application
```

Original provider bytes are archived by the capability-owning runtime. Core
records only identify those bytes by content address and retain the provenance
needed to rebuild downstream projections.

## Package project

```edn
{:hara/type :project
 :hara/version "1.0.0"
 :project/id greenways/historia-core
 :project/version "0.1.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/capabilities #{}
 :project/dependencies {}}
```

Validate it independently:

```bash
target/bin/hara --project packages/core check
target/bin/hara --project packages/core test
```

## Source and provider contracts

A source document points at immutable original content without embedding it:

```clojure
(source/document
 "source:openai:conversation-1:revision-1"
 "openai.conversation"
 "openai-export"
 "conversation-1"
 "revision-1"
 "2026-08-19T11:00:00Z"
 (source/blob
  "sha256"
  "f00d"
  128
  "application/json"
  {"kind" "git-object"
   "oid" "blob-1"})
 {"sourceKind" "official-export"})
```

Normalized blocks retain that provenance as a first-class source anchor:

```clojure
(artifact/anchored-block
 "conversation:1/message:2/block:1"
 "code"
 "answer = 42"
 {"language" "python"}
 (source/anchor
  "source:openai:conversation-1:revision-1"
  12
  48
  2
  4
  {"path" "messages/answer"}))
```

A provider descriptor is static data. Registration does not install an
executable callback or credential:

```clojure
(provider/register
 (provider/create-registry)
 (provider/descriptor
  "openai-export"
  "0-alpha"
  ["discover" "pull" "status"]
  ["openai.export" "openai.conversation"]
  ["conversation" "message"]
  {"readOnly" true}))
```

Historia Runtime binds descriptors to capability-owning executors, archives
source documents and receipts, then normalizes them into artifacts. Greenways
Intel consumes those shared IDs to build typed code, conversation, work, and
evidence graphs.

## Consumer project

A published or locally installed package is selected with only its coordinate:

```edn
{:hara/type :project
 :hara/version "1.0.0"
 :project/id example/my-historian
 :project/version "0.1.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/main example.main
 :project/capabilities #{}
 :project/dependencies
 {greenways/historia-core {:version "^0.1.0"}}}
```

No Historia checkout path, symlink, or application capability is required. The
package supplies records and analyser/provider contracts; the consumer remains
capability-free and chooses any runtime broker separately.

The repository keeps two proofs:

- `examples/historia-core-consumer` is the source-development fixture. It stages
  package source under the consumer's own ignored `target/` directory.
- `scripts/verify-installed-historia-core` builds a real deterministic HARP,
  installs it into an isolated `HARA_DIST_HOME`, creates a consumer outside the
  Historia checkout, and verifies `check`, `test`, `eval`, and the native REPL
  using only the coordinate. It then removes the registration and verifies the
  same consumer fails closed.

```bash
scripts/materialize-historia-core-consumer
target/bin/hara --project examples/historia-core-consumer check
target/bin/hara --project examples/historia-core-consumer test

sh scripts/verify-installed-historia-core
```

Source-ready and locally installable do not mean publicly published. The package
must not be described as available from `packages.hara-lang.org` until the signed
registry publication and attestation have been accepted and read back.
