# Historia Hara analyser

Historia owns analyser policy in [`analyzer.hal`](analyzer.hal). The reusable
whole-Wasm JSONL host remains in `hara-lang/hara`; Historia does not carry an
application-specific Rust analyser crate.

The worker is pinned to the immutable Hara commit:

```text
dc6f3b4b25e70f4d2abc360cf70e08fa6e95d342
```

That commit provides the generic command:

```text
hara-rust-full analyzer MODULE.hal
```

The pin is intentionally separate from the Hara application runtime. Updating it
requires a reviewed change, a successful build, protocol conformance, response
shape validation, and the controlled benchmark matrix.

## Ownership boundary

Hara owns:

- persistent JSONL request and response framing;
- the non-evaluating spanned reader;
- whole-function Wasm preparation and invocation;
- source ranges, UTF-16 display columns, hashes, and result materialization.

Historia owns:

- the `describe` and `analyze` policy functions in `analyzer.hal`;
- analyser protocol fixtures and conformance expectations;
- worker registration in the Historia application;
- controlled performance and response-shape gates.

## Build and run

```sh
bun run hara:build
analyzers/hara/bin/historia-hara-analyzer
```

The build records the exact checked-out revision at:

```text
analyzers/hara/target/hara-runtime-revision.txt
```

A missing or mismatched upstream revision fails before Historia conformance is
run, so dependency failures remain distinguishable from analyser-policy failures.

## Verification

```sh
bun run conformance:hara
bun run analyzer:shape
bun run benchmark:clojure-analyzer-matrix
```
