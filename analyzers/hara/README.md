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
bun run analyzer:parity
bun run benchmark:clojure-analyzers
```

`analyzer:parity` compares the complete canonicalized `analyze` response from
Babashka and Hara. It includes file metadata, all source ranges, symbols,
references, hashes, structural features, structure, and diagnostics. The speed
benchmark is not allowed to publish timings unless that exact-output gate has
already passed for every fixture.
