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

The repository includes `examples/historia-core-consumer`. Its manifest declares
the intended public dependency:

```edn
:project/dependencies
{greenways/historia-core {:version "^0.1.0"}}
```

Until an immutable package is installed, the source-development fixture stages
`packages/core/src` beneath the consumer's own `target/` directory. This avoids
an escaping source path and does not commit a second copy of the package.

```bash
scripts/materialize-historia-core-consumer
target/bin/hara --project examples/historia-core-consumer check
target/bin/hara --project examples/historia-core-consumer test
```

Coordinate-only installed-package consumption is intentionally tracked
separately in issue #78 and depends on Hara's installed dependency activation.
This source package must not be described as public on `packages.hara-lang.org`
until the signed registry publication has been accepted and read back.
