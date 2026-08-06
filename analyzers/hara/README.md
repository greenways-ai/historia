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

Structural keyword and string-literal tokens follow rewrite-clj's observed
generic-token behavior and normalize to `[:symbol]`. This preserves the
Babashka analyzer's complete shape, feature, depth, node-count, and
structural-hash output while the reader tree still retains the original token
kind for call filtering and protocol materialization.

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
