use hara_wasm::kernel::{normalize_schema, read_forms, Form, SchemaType};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

const ANALYZER_NAMESPACE: &str = "greenways-historian.hara-analyzer";
// Updated together with the pinned hara-wasm git revision in Cargo.toml.
const HARA_RUNTIME_REV: &str = "79a289f36ec6528426da88cb9bcc80c504bfd9eb";

fn main() {
    println!("cargo:rerun-if-changed=analyzer.hal");
    println!("cargo:rustc-env=HISTORIA_HARA_RUNTIME_REV={HARA_RUNTIME_REV}");

    let source = fs::read_to_string("analyzer.hal").expect("read analyzer.hal");
    let mut program =
        hara_wasm::vm::compile_source(&source).expect("compile analyzer.hal to Hara bytecode");
    program.namespace = Some(ANALYZER_NAMESPACE.to_owned());
    program.function_types = declared_function_types(&source);

    for function in &program.functions {
        let Some(name) = function.name.as_deref() else {
            continue;
        };
        let local = name.rsplit('/').next().unwrap_or(name);
        let qualified = format!("{ANALYZER_NAMESPACE}/{local}");
        assert!(
            program.function_types.contains_key(&qualified),
            "analyzer function {local} has no ^:schema declaration"
        );
    }

    let artifact = hara_wasm::whole_wasm::compile_artifact(&program)
        .expect("lower analyzer.hal to hara-rust-full whole-Wasm");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"))
        .join("historia-analyzer.hnw");
    fs::write(output, artifact).expect("write embedded whole-Wasm analyzer");
}

fn declared_function_types(source: &str) -> HashMap<String, SchemaType> {
    let forms = read_forms(source).expect("read analyzer.hal schemas");
    let mut declared = HashMap::new();
    for spanned in forms {
        let Form::List(items) = spanned.form else {
            continue;
        };
        if !matches!(items.first(), Some(Form::Symbol(operator)) if operator == "defn" || operator == "defn-") {
            continue;
        }
        let Some((name, metadata)) = items.get(1).and_then(definition_metadata) else {
            continue;
        };
        let schema = metadata
            .iter()
            .find_map(|(key, value)| match key {
                Form::Keyword(name) if name == "schema" => Some(value),
                _ => None,
            })
            .unwrap_or_else(|| panic!("analyzer function {name} has no :schema metadata"));
        let normalized = normalize_schema(schema)
            .unwrap_or_else(|error| panic!("invalid schema for analyzer function {name}: {error}"));
        declared.insert(format!("{ANALYZER_NAMESPACE}/{name}"), normalized);
    }
    declared
}

fn definition_metadata(form: &Form) -> Option<(String, &[(Form, Form)])> {
    let Form::Metadata(metadata, value) = form else {
        return None;
    };
    let Form::Symbol(name) = value.as_ref() else {
        return None;
    };
    let Form::Map(entries) = metadata.as_ref() else {
        return None;
    };
    Some((name.clone(), entries.as_slice()))
}
