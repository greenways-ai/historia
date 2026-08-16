# Historia Core

`greenways/historia-core` is the capability-free Hara package containing
Historia's provider-neutral artifact, analyser-description and index contracts.
It is independent of the Historia executable, Git vault, network providers and
process supervision.

## Select it from a project

After the signed `0.1.0` registry publication is accepted, a project selects the
package with one dependency:

```edn
{:hara/type :project
 :hara/version "1.0.0"
 :project/id example/my-historian
 :project/version "0.1.0"
 :project/source-paths ["src"]
 :project/test-paths ["test"]
 :project/extension-paths []
 :project/capabilities #{}
 :project/dependencies {greenways/historia-core "^0.1.0"}}
```

Or add the same coordinate through the CLI:

```bash
hara --project . project add greenways/historia-core@^0.1.0
hara --project . project sync
```

The package exposes artifact, analysis, link and index records plus descriptors
for JavaScript/TypeScript, Python, Clojure/Babashka and Hara. It deliberately
does not choose process commands or acquire process capability. A consuming
application attaches local, remote or sandboxed workers to those descriptors.

The repository includes `examples/historia-core-consumer` as a capability-free
consumer. During source development it materializes the same package through a
local source path while retaining the public dependency coordinate in its
manifest.

## Validate from source

```bash
target/bin/hara --project packages/core check
target/bin/hara --project packages/core test

target/bin/hara --project examples/historia-core-consumer check
target/bin/hara --project examples/historia-core-consumer test
```

The package is source-ready for the reviewed Hara package publication flow. It
is not installable from `packages.hara-lang.org` until an immutable signed
publication request is accepted by the registry.
