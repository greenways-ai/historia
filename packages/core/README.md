# Historia Core

`greenways/historia-core` is the capability-free Hara package containing
Historia's provider-neutral artifact, analyser-description and index contracts.

It is intentionally independent of the Historia executable, Git vault, network
providers and process supervision.

```bash
target/bin/hara --project packages/core check
target/bin/hara --project packages/core test
```

The package is source-ready for the reviewed Hara package publication flow. It
is not installable from `packages.hara-lang.org` until an immutable signed
publication request is accepted by the registry.
