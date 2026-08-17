# Historia analyzer for `hara-rust-full`

Historia remains a **Bun/JavaScript application with SQLite storage**. This
directory contains an optional Clojure/Babashka analyzer module; it does not
turn Historia into a Rust application.

The existing Babashka + `rewrite-clj` worker in `../clojure` remains available
and unchanged. Historia's alternative analyzer policy is authored entirely in
[`analyzer.hal`](analyzer.hal):

- `describe` declares protocol metadata and capabilities;
- `analyze` performs namespace and import discovery, definition
  classification, call extraction, and structural shaping.

Reusable runtime machinery belongs to `hara-lang/hara`, which provides the
`hara-rust-full analyzer MODULE.hal` command. Hara owns:

- persistent JSONL protocol framing;
- its non-evaluating spanned reader;
- preparation of the `.hal` module as whole-function Wasm;
- source ranges, UTF-16 display columns, source hashes, and result
  materialization;
- optional phase timing through `HARA_ANALYZER_PROFILE=1`.

Historia no longer carries a Cargo crate, `build.rs`, or application-specific
Rust analyzer host.

## Direct in-process value boundary

For a local persistent worker, the Hara host and prepared whole-Wasm module are
already in the same process. The hot path therefore calls
`NativeModule::call_value` directly:

```text
Historia JSONL request
        │
Hara spanned reader
        │
compact Hara value tree: [nodes roots]
        │
direct whole-Wasm value call
        │
analyzer.hal
        │
direct Hara value result
        │
Historia protocol JSON
```

It deliberately avoids the previous same-process sequence:

```text
HTA encode → HTA decode → whole-Wasm → HTA encode → HTA decode
→ value display → source reparse
```

HTA0 remains the portable cross-process value format in Hara, but it is not
needed for this in-process analyzer call.

The Hara host also avoids retaining cloned reader `Form` trees, does not render
collection subtrees merely to intern tokens, uses parser child spans for exact
selection ranges, indexes line starts once per source file, and computes
structural summaries in one pass.

## Structural semantics

The Hara analyzer follows the Hara reader rather than reproducing quirks in the
Babashka/rewrite-clj implementation. In particular:

- keyword literals retain their value, for example `[:keyword ":status"]`;
- string literals retain their kind as `[:string]`;
- symbols remain `[:symbol]`.

The smoke gate compares protocol response shape—required fields, nested
containers, and JSON scalar types—not analyzer values or hashes. Targeted Hara
semantic tests remain responsible for the richer literal distinctions.

## Build and run

Build the Hara-owned runtime and install the compatibility launcher:

```sh
bun run hara:build
```

Run the Historia analyzer:

```sh
analyzers/hara/bin/historia-hara-analyzer
```

An already installed runtime can be selected explicitly:

```sh
HARA_RUST_FULL=/path/to/hara-rust-full \
  analyzers/hara/bin/historia-hara-analyzer
```

The underlying invocation is:

```sh
hara-rust-full analyzer analyzers/hara/analyzer.hal
```

## Verification

```sh
bun run hara:test
bun run benchmark:clojure-analyzers
bun run benchmark:clojure-analyzer-matrix
```

`hara:test` builds the generic Hara runtime, checks Historia analyzer-protocol
conformance, and runs the fixed response-shape smoke fixtures. The benchmark
matrix runs only after the same shape contract passes.
