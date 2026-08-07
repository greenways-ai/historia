# Historia as a Hara application

Historia is moving from a Bun application to a Hara application. The migration
is tracked in [issue #65](https://github.com/greenways-ai/historia/issues/65)
and is intentionally split into dependency-complete slices.

## Boundary

Historia owns product policy in `.hal`:

- commands and output contracts;
- Git-vault layout and archive workflows;
- import normalization and receipts;
- index, graph, topic, retrieval and context semantics.

Hara owns generic host capabilities:

- project and executable startup;
- argv, stdout, stderr and exit codes;
- files, processes, sockets and databases;
- package, deployment and browser/Wasm bootstrap machinery.

There must not be a Historia-local Rust runtime. During migration the existing
Bun implementation is retained only as a parity oracle for commands that have
not yet moved.

## First runnable slice

The root `project.edn` now defines a native Hara application. Its main namespace
is `historia.main`; invocation data is supplied by the generic `hara-app`
runtime through `hara.cli.application/request`.

Implemented in Hara:

```text
historia --help
historia --version
historia vault init [--vault PATH]
historia vault verify [--vault PATH]
```

Build and test without Bun or Node:

```sh
sh bin/build-hara-app
target/bin/hara --project . test
bin/historia --help
bin/historia vault init --vault target/example-vault.git
bin/historia vault verify --vault target/example-vault.git
```

The vault implementation invokes Git with argv vectors through Hara's explicit
process capability. It never constructs a shell command. JSON responses are
returned through the Hara application result protocol.

## Next slices

The next dependency-complete changes port Git object/ref transactions and
OpenAI export normalization, then the rebuildable SQLite index, collection
services and optional model workers. Bun is removed only after each command has
a committed Hara parity fixture.
