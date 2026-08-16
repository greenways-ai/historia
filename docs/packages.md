# Historia Hara packages

Historia is organized as a Hara application plus capability-bounded reusable
packages. The repository root remains the application project.

## Package coordinates

| Source root | Coordinate | Capabilities | Purpose |
| --- | --- | --- | --- |
| `/` | `greenways/historia` | `:file`, `:process` | CLI, vault, native REPL, built-in workers, kernel assembly and integration tests |
| `packages/core` | `greenways/historia-core` | none | Artifact, analyser-description and rebuildable-index contracts |

The root project declares `greenways/historia-core` and materializes it through
`packages/core/src` during source development. This keeps CI independent of an
unpublished registry artifact while exercising the same namespace boundary that
a registry consumer will use.

A standalone consumer needs only:

```edn
:project/dependencies {greenways/historia-core "^0.1.0"}
```

`examples/historia-core-consumer` is a capability-free proof project. It uses the
artifact and index contracts and selects analyser families without depending on
the Historia executable or obtaining process authority.

## Analyser boundary

`greenways/historia-core` includes the common JSONL request contract and four
portable analyser descriptors:

| Family | Languages | Core responsibility |
| --- | --- | --- |
| JavaScript | JavaScript, JSX, TypeScript, TSX | language selection and request contract |
| Python | Python | language selection and request contract |
| Clojure | Clojure, Babashka | language selection and request contract |
| Hara | Hara | language selection and request contract |

The core descriptors contain no executable commands. The application namespace
`historia.analyzers` attaches the checked-in workers under `analyzers/` and owns
the `:process` authority needed to start them. This lets another project select
only `historia-core` and provide a different worker broker without inheriting
Historia's application authority.

Provider packages will be split only after the core package contract and Hara
registry dependency resolution are stable. GitHub network access does not belong
in the capability-free core package.

## Local validation

```bash
target/bin/hara --project packages/core check
target/bin/hara --project packages/core test

target/bin/hara --project examples/historia-core-consumer check
target/bin/hara --project examples/historia-core-consumer test

target/bin/hara --project . check
target/bin/hara --project . test

scripts/check-analyzer-assets

bin/historia repl --eval \
  '(do (require [historia.repl :as historia]) (historia/describe))'
```

`historia repl` delegates evaluation to Hara's native REPL. The generic Hara
runtime registers every effective project source path, so the REPL sees both the
application and selected package namespaces. The REPL remains offline unless
`--resp` is supplied.

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
