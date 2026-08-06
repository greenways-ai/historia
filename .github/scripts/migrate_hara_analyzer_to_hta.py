from pathlib import Path

HARA_REV = "79a289f36ec6528426da88cb9bcc80c504bfd9eb"


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
    "use hara_wasm::lang::protocol::IDisplay;\n",
    "",
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

# rewrite-clj represents keyword literals as generic token nodes. The existing
# Babashka structural normalizer therefore reaches its fallback `[:symbol]`
# branch for keywords. Preserve that observed output exactly rather than the
# dormant `:keyword` branch in structural.clj.
replace(
    "analyzers/hara/src/engine.rs",
    "        Form::Keyword(_) => 1,\n",
    "        Form::Keyword(_) => 0,\n",
)

# #355 uses declared function schemas to choose the whole-Wasm ABI. Reader
# rows are heterogeneous handles, while root/child vectors contain integer node
# IDs. Keep generic node-at for handle-valued reads and introduce int-at so Nth
# results are unboxed before control-flow joins and integer call boundaries.
analyzer = Path("analyzers/hara/analyzer.hal")
analyzer_source = analyzer.read_text()
node_at = '''(defn ^{:schema [:fn [:any :int] :any]}
  node-at
  [nodes node-id]
  (nth nodes node-id))
'''
int_at = node_at + '''
(defn ^{:schema [:fn [:any :int] :int]}
  int-at
  [values index]
  (nth values index))
'''
if analyzer_source.count(node_at) != 1:
    raise SystemExit("analyzers/hara/analyzer.hal: node-at declaration changed")
analyzer_source = analyzer_source.replace(node_at, int_at)

replacements = [
    ("(nth children index)", "(int-at children index)", 3),
    ("(nth children 0)", "(int-at children 0)", 6),
    ("(nth children 1)", "(int-at children 1)", 2),
    ("(nth roots index)", "(int-at roots index)", 3),
    ("(nth clause-children index)", "(int-at clause-children index)", 1),
    ("(nth clause-children 0)", "(int-at clause-children 0)", 1),
    ("(nth ns-children index)", "(int-at ns-children index)", 1),
    ("(nth input 0)", "(node-at input 0)", 1),
    ("(nth input 1)", "(node-at input 1)", 1),
    (
        "(nth (nth definitions index) 0)",
        "(int-at (node-at definitions index) 0)",
        1,
    ),
]
for old, new, expected in replacements:
    found = analyzer_source.count(old)
    if found != expected:
        raise SystemExit(
            f"analyzers/hara/analyzer.hal: expected {expected} occurrence(s) of {old}, found {found}"
        )
    analyzer_source = analyzer_source.replace(old, new)
analyzer.write_text(analyzer_source)

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

The runtime revision is pinned to the HTTPS-fetchable Hara revision that
contains #355, so a clean Cargo checkout does not require GitHub SSH credentials.

The compact reader tree deliberately distinguishes heterogeneous handle-valued
rows (`node-at`) from integer root and child-ID sequences (`int-at`). Those
schemas let #355 prove each whole-Wasm call and branch representation without
unchecked casts or changing analyzer output.

Structural keyword tokens follow rewrite-clj's observed generic-token behavior
and normalize to `[:symbol]`; this preserves the Babashka analyzer's complete
shape, feature, depth and hash output.

'''
readme.write_text(text.replace(needle, section + needle))
