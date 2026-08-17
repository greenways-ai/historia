# Historia Core

`greenways/historia-core` is the capability-free Hara package at the centre of
Historia. It contains provider-neutral artifact, block, analysis and link
records, portable analyser-family descriptors, the canonical analyser request
envelope, and the pure rebuildable in-memory index contract.

It does not contain the Historia executable, Git vault, provider network access,
worker commands, process supervision, Bun, Python, Babashka, or another runtime.
A consuming application decides how analyser descriptors are connected to local,
remote, or sandboxed workers.

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
package supplies records and analyser contracts; the consumer remains
capability-free and chooses any worker broker separately.

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
