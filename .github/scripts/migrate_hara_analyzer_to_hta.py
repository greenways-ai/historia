from pathlib import Path

HARA_REV = "deb9a5fbbf2d48dd0d4b2735f82c83da557ea964"


def replace(path: str, old: str, new: str, count: int | None = None) -> None:
    target = Path(path)
    source = target.read_text()
    found = source.count(old)
    expected = 1 if count is None else count
    if found != expected:
        raise SystemExit(f"{path}: expected {expected} occurrence(s), found {found}")
    target.write_text(source.replace(old, new))


replace(
    "analyzers/hara/Cargo.toml",
    'rev = "fa712a7f55b0374b9ec8cc7a1d967945fcaa605f"',
    f'rev = "{HARA_REV}"',
    2,
)

replace(
    "analyzers/hara/build.rs",
    'const HARA_RUNTIME_REV: &str = "65ccb88ff42ec2774f27cc176abbc034ba0ec221";',
    f'const HARA_RUNTIME_REV: &str = "{HARA_REV}";',
)

replace(
    "analyzers/hara/src/engine.rs",
    '''        let input = tree.hara_value();
        let encoded = self
            .module
            .call_value(self.analyze_function, &[input])
            .map_err(|error| AnalyzerFailure::new("internal_error", error))?;
        let output = hara_wasm::kernel::parse(&encoded.display())
            .map_err(|error| AnalyzerFailure::new("internal_error", error.to_string()))?;
''',
    '''        // HTA1 is the portable boundary between the persistent Historia
        // worker and the prepared whole-Wasm module. The invocation frame is a
        // sequence because call_hta accepts one frame containing all arguments.
        let invocation = vector([tree.hara_value()]);
        let request_frame = hara_wasm::hta::encode(&invocation)
            .map_err(|error| AnalyzerFailure::new("internal_error", error))?;
        let response_frame = self
            .module
            .call_hta(self.analyze_function, &request_frame)
            .map_err(|error| AnalyzerFailure::new("internal_error", error))?;
        let encoded = hara_wasm::hta::decode(&response_frame)
            .map_err(|error| AnalyzerFailure::new("internal_error", error))?;
        let output = hara_wasm::kernel::parse(&encoded.display())
            .map_err(|error| AnalyzerFailure::new("internal_error", error.to_string()))?;
''',
)

replace(
    "analyzers/hara/src/engine.rs",
    'digest.update(b"hara-rust-full:whole-wasm:value-abi-v1");',
    'digest.update(b"hara-rust-full:whole-wasm:hta1-boundary-v1");',
)

readme = Path("analyzers/hara/README.md")
text = readme.read_text()
needle = "## Build and run\n"
if text.count(needle) != 1:
    raise SystemExit("analyzers/hara/README.md: build section marker changed")
section = '''## Portable HTA boundary

The persistent host invokes the compiled `analyze` function through
`NativeModule::call_hta`, introduced by `hara-lang/hara#355`. It encodes one
sequential HTA1 argument frame, enters the prepared whole-Wasm module, and
decodes one HTA1 result frame. Calls between functions inside `analyzer.hal`
remain in the scoped whole-Wasm value arena and are not repeatedly serialized.

The runtime revision is pinned to the HTTPS-fetchable Hara main commit that
contains #355, so a clean Cargo checkout does not require GitHub SSH credentials.

'''
readme.write_text(text.replace(needle, section + needle))
