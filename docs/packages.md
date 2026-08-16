# Historia Hara packages

Historia is organized as a Hara application plus capability-bounded reusable
packages. The repository root remains the application project.

## Package coordinates

| Source root | Coordinate | Capabilities | Purpose |
| --- | --- | --- | --- |
| `/` | `greenways/historia` | `:file`, `:process` | CLI, vault, native REPL, kernel assembly and integration tests |
| `packages/core` | `greenways/historia-core` | none | Artifact, analyser-description and rebuildable-index contracts |

The root project includes `packages/core/src` as a local source path. This keeps
development and CI independent of an unpublished registry dependency while the
core package remains independently checkable and testable.

Provider packages will be split only after the core package contract and Hara
registry dependency resolution are stable. In particular, GitHub network access
does not belong in the capability-free core package.

## Local validation

```bash
target/bin/hara --project packages/core check
target/bin/hara --project packages/core test

target/bin/hara --project . check
target/bin/hara --project . test

bin/historia repl --eval \
  '(do (require [historia.repl :as historia]) (historia/describe))'
```

`historia repl` delegates evaluation to Hara's native REPL. Historia creates a
disposable source overlay from the declared local module roots because the
currently pinned native REPL accepts one filesystem root. The overlay contains
source only, is rebuilt for every launch and is never authoritative.

The REPL is offline by default:

```bash
historia repl
```

Enable the local RESP listener explicitly:

```bash
historia repl --resp
```

## Publication to packages.hara-lang.org

A valid `project.edn` makes a module package-ready; it does not publish it. The
reviewed registry flow requires an immutable source version after the source PR
has merged:

1. tag the exact reviewed source commit;
2. build the package HARP artifact with Hara;
3. record the artifact SHA-256 and detached Ed25519 signature;
4. create a `:package-publication-request` with the exact repository, source
   commit, tag, source root, namespaces, reproducibility command and publisher
   key;
5. submit and verify a PR to `hara-lang/hara-packages`;
6. wait for protected registry publication and attestation.

The intended order is:

```text
greenways/historia-core
  → greenways/historia
  → later provider and analyser packages
```

No package in this repository should be described as installable from the public
registry until the corresponding registry PR and attestation exist.
