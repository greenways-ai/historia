# Historia analyzer for `hara-rust-full`

This is Historia's second Clojure/Babashka analyzer backend. The existing
Babashka + `rewrite-clj` worker in `../clojure` remains available and unchanged.

The analyzer logic is authored in [`analyzer.hal`](analyzer.hal). During the
Rust build, that source is compiled to Hara bytecode and then lowered through
Hara's whole-function Wasm tier—the runtime identified by the Hara benchmark
suite as **`hara-rust-full`**. The resulting whole-Wasm artifact is embedded in
a small persistent JSONL host.

The host is intentionally limited to the protocol boundary and source facts
that the `.hal` program cannot obtain by executing user code:

- JSONL framing and strict JSON encoding;
- Hara's non-evaluating, spanned reader;
- exact UTF-8 source slicing and SHA-256;
- conversion between protocol JSON and Hara values.

Namespace discovery, import discovery, definition classification, call
extraction, and structural shape generation execute in `analyzer.hal` through
`hara-rust-full`.

## Portable HTA1 boundary

The persistent host invokes the compiled `analyze` function through
`NativeModule::call_hta`, introduced by `hara-lang/hara#355`. It encodes one
sequential HTA1 argument frame, enters the prepared whole-Wasm module, and
decodes one HTA1 result frame. Calls between functions inside `analyzer.hal`
remain in the scoped whole-Wasm value arena and are not repeatedly serialized.

The Hara dependency is pinned to the HTTPS-fetchable merged revision containing
#355. The compact reader tree deliberately distinguishes heterogeneous
handle-valued rows (`node-at`) from integer root and child-ID sequences
(`int-at`). Those schemas let whole-Wasm prove each call and branch
representation without unchecked casts or changes to the analyzer protocol.

## Structural semantics

The Hara analyzer follows the Hara reader rather than reproducing quirks in the
Babashka/rewrite-clj implementation. In particular:

- keyword literals retain their value, for example `[:keyword ":status"]`;
- string literals retain their kind as `[:string]`;
- symbols remain `[:symbol]`.

The two analyzers therefore do not have to produce identical structural hashes
or feature values. Historia instead smoke-tests that both implementations obey
the same protocol response shape: required object fields, arrays, nested
containers, and scalar value types. Empty arrays and nullable scalar fields are
accepted as schema-compatible; analyzer values and array lengths are not
compared.

## Build and run

```sh
cargo build --release --manifest-path analyzers/hara/Cargo.toml
./analyzers/hara/target/release/historia-hara-analyzer
```

Or use the launcher, which builds the release binary when needed:

```sh
analyzers/hara/bin/historia-hara-analyzer
```

## Verification

```sh
cargo test --manifest-path analyzers/hara/Cargo.toml
bun run conformance:hara
bun run analyzer:shape
bun run benchmark:clojure-analyzers
bun run benchmark:clojure-analyzer-matrix
```

`analyzer:shape` checks `describe`, `ping`, and the fixed Clojure/Babashka
analysis fixtures. The benchmark matrix runs only after that response-shape
smoke test passes, while allowing each analyzer to retain its own semantically
correct structural content.
