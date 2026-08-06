use crate::shape;
use hara_wasm::core::Value as HaraValue;
use hara_wasm::kernel::{read_forms, Form, Span, SpannedForm};
use hara_wasm::lang::data::Vector as HaraVector;
use hara_wasm::vm::FunctionId;
use hara_wasm::whole_wasm::NativeModule;
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

const MAX_MESSAGE_BYTES: usize = 10 * 1024 * 1024;

pub struct AnalyzerEngine {
    module: NativeModule,
    analyze_function: FunctionId,
}

pub struct Tokens {
    values: Vec<String>,
    indexes: HashMap<String, i64>,
}

impl Default for Tokens {
    fn default() -> Self {
        let mut tokens = Self {
            values: Vec::new(),
            indexes: HashMap::new(),
        };
        for value in [
            "def", "defonce", "defn", "defn-", "defmacro", "defmulti",
            "defmethod", "defprotocol", "defrecord", "deftype", "deftest", "ns",
            "fn", "fn*", "let", "letfn", "loop", "recur", "if", "if-not",
            "when", "when-not", "cond", "condp", "case", "do", "quote", "var",
            "set!", "try", "catch", "finally", "throw", "new", ".", "..", "doto",
            "locking", "with-open", "binding", "for", "doseq", "dotimes", "comment",
            "require", ":require",
        ] {
            tokens.intern(value.to_owned());
        }
        tokens
    }
}

impl Tokens {
    fn intern(&mut self, value: String) -> i64 {
        if let Some(index) = self.indexes.get(&value) {
            return *index;
        }
        let index = self.values.len() as i64;
        self.values.push(value.clone());
        self.indexes.insert(value, index);
        index
    }

    pub fn get(&self, index: i64) -> Result<String, String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.values.get(index))
            .cloned()
            .ok_or_else(|| format!("unknown token index {index}"))
    }
}

#[derive(Clone)]
struct HostNode {
    form: Form,
    span: Span,
    shape_code: i64,
    token: i64,
    children: Vec<usize>,
}

struct EncodedTree {
    nodes: Vec<HostNode>,
    roots: Vec<usize>,
    tokens: Tokens,
}

impl AnalyzerEngine {
    pub fn new() -> Result<Self, String> {
        let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/historia-analyzer.hnw"));
        let module = NativeModule::load(bytes)?;
        let analyze_function = module
            .artifact()
            .program
            .functions
            .iter()
            .position(|function| function.name.as_deref() == Some("analyze"))
            .ok_or("compiled analyzer has no analyze function")? as FunctionId;
        Ok(Self {
            module,
            analyze_function,
        })
    }

    pub fn analyze(&mut self, request: &JsonValue) -> Result<JsonValue, AnalyzerFailure> {
        let language = required_string(request, "language", false)?;
        if language != "clojure" && language != "babashka" {
            return Err(AnalyzerFailure::new(
                "unsupported_language",
                format!("unsupported language: {language}"),
            ));
        }
        let path = required_string(request, "path", false)?;
        let blob_oid = required_string(request, "blob_oid", false)?;
        let source = required_string(request, "source", true)?;
        if source.len() > MAX_MESSAGE_BYTES {
            return Err(AnalyzerFailure::new(
                "too_large",
                "source exceeds analyzer limit",
            ));
        }

        let forms = read_forms(source)
            .map_err(|error| AnalyzerFailure::new("parse_error", error.to_string()))?;
        let tree = EncodedTree::new(source, &forms);

        // HTA1 is the portable boundary between the persistent Historia worker
        // and the prepared whole-Wasm module. One sequential frame contains all
        // Hara call arguments; internal analyzer calls remain handle-native.
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
        materialize(source, language, path, blob_oid, tree, output)
            .map_err(|error| AnalyzerFailure::new("internal_error", error))
    }
}

impl EncodedTree {
    fn new(source: &str, forms: &[SpannedForm]) -> Self {
        let mut tree = Self {
            nodes: Vec::new(),
            roots: Vec::new(),
            tokens: Tokens::default(),
        };
        for form in forms {
            let root = tree.push(source, form);
            tree.roots.push(root);
        }
        tree
    }

    fn push(&mut self, source: &str, value: &SpannedForm) -> usize {
        let children = value
            .children
            .iter()
            .map(|child| self.push(source, child))
            .collect::<Vec<_>>();
        let token_text = token_text(&value.form);
        let token = self.tokens.intern(token_text.clone());
        let shape_code = shape_code(source, value);
        let index = self.nodes.len();
        self.nodes.push(HostNode {
            form: value.form.clone(),
            span: value.span.clone(),
            shape_code,
            token,
            children,
        });
        index
    }

    fn hara_value(&self) -> HaraValue {
        let nodes = vector(self.nodes.iter().map(HostNode::hara_value));
        let roots = vector(
            self.roots
                .iter()
                .map(|index| HaraValue::Number(*index as i64)),
        );
        vector([nodes, roots])
    }
}

impl HostNode {
    fn hara_value(&self) -> HaraValue {
        vector([
            HaraValue::Number(self.shape_code),
            HaraValue::Number(self.token),
            vector(
                self.children
                    .iter()
                    .map(|index| HaraValue::Number(*index as i64)),
            ),
        ])
    }
}

fn vector(values: impl IntoIterator<Item = HaraValue>) -> HaraValue {
    HaraValue::Vector(HaraVector::from_iter(values))
}

fn shape_code(source: &str, value: &SpannedForm) -> i64 {
    match &value.form {
        // Keep keyword identity for call filtering. analyzer.hal deliberately
        // maps this code to the same structural [:symbol] shape as rewrite-clj.
        Form::Keyword(_) => 1,
        Form::String(_) => 2,
        Form::Number(_) | Form::Float(_) | Form::BigInteger(_) | Form::Decimal(_) => 3,
        Form::Nil | Form::Bool(_) => 4,
        Form::Vector(_) => 11,
        Form::Map(_) => 12,
        Form::Set(_) => 13,
        Form::List(_) => synthetic_prefix(source, value).unwrap_or(10),
        _ => 0,
    }
}

fn synthetic_prefix(source: &str, value: &SpannedForm) -> Option<i64> {
    if value.children.len() != 1 {
        return None;
    }
    let slice = source.get(value.span.start.offset..value.span.end.offset)?;
    if slice.starts_with("~@") {
        Some(19)
    } else if slice.starts_with('~') {
        Some(18)
    } else if slice.starts_with('`') {
        Some(17)
    } else if slice.starts_with('\'') {
        Some(16)
    } else if slice.starts_with('@') {
        Some(15)
    } else {
        None
    }
}

fn token_text(form: &Form) -> String {
    match form {
        Form::Metadata(_, value) => token_text(value),
        Form::Symbol(value) => value.clone(),
        Form::Keyword(value) => format!(":{value}"),
        Form::String(value) => value.clone(),
        Form::Character(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn materialize(
    source: &str,
    language: &str,
    path: &str,
    blob_oid: &str,
    tree: EncodedTree,
    output: Form,
) -> Result<JsonValue, String> {
    let output = form_vector(&output)?;
    if output.len() != 4 {
        return Err(format!(
            "Hara analyzer returned {} fields, expected 4",
            output.len()
        ));
    }
    let namespace_index = form_number(&output[0])?;
    let namespace = if namespace_index < 0 {
        JsonValue::Null
    } else {
        JsonValue::String(tree.tokens.get(namespace_index)?)
    };

    let imports = form_vector(&output[1])?
        .iter()
        .map(|value| {
            let node = node(&tree.nodes, form_number(value)?)?;
            Ok(JsonValue::String(node.form.to_string()))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let definitions = form_vector(&output[2])?;
    let mut symbols = Vec::with_capacity(definitions.len());
    let mut definition_cursor = 0usize;
    for (index, definition) in definitions.iter().enumerate() {
        let values = form_vector(definition)?;
        if values.len() != 7 {
            return Err(format!("definition {index} has {} fields", values.len()));
        }
        let node_id = form_number(&values[0])?;
        let head = tree.tokens.get(form_number(&values[1])?)?;
        let name = tree.tokens.get(form_number(&values[2])?)?;
        let signature_id = form_number(&values[3])?;
        let kind = definition_kind(form_number(&values[4])?)?;
        let private = form_number(&values[5])? == 1;
        let definition_node = node(&tree.nodes, node_id)?;
        let start = definition_node.span.start.offset;
        let end = definition_node.span.end.offset;
        let snippet = source
            .get(start..end)
            .ok_or_else(|| format!("definition {index} span is outside source"))?;
        let selection_start = source
            .get(definition_cursor..)
            .and_then(|tail| tail.find(&name).map(|offset| definition_cursor + offset))
            .unwrap_or(definition_cursor);
        let selection_end = selection_start + name.len();
        definition_cursor = end;

        let features = shape::structural_features(&values[6], &tree.tokens)?;
        let structural_hash = features
            .get("shape_hash")
            .and_then(JsonValue::as_str)
            .ok_or("structural features have no shape_hash")?
            .to_owned();
        let signature = if signature_id < 0 {
            JsonValue::Null
        } else {
            let signature_node = node(&tree.nodes, signature_id)?;
            JsonValue::String(
                source
                    .get(signature_node.span.start.offset..signature_node.span.end.offset)
                    .ok_or("signature span is outside source")?
                    .to_owned(),
            )
        };
        let qualified_name = match namespace.as_str() {
            Some(namespace) => format!("{namespace}/{name}"),
            None => name.clone(),
        };

        symbols.push(json!({
            "local_id": format!("symbol-{index}"),
            "kind": kind,
            "name": name,
            "qualified_name": qualified_name,
            "range": source_range(source, start, end),
            "selection_range": source_range(source, selection_start, selection_end),
            "signature": signature,
            "modifiers": if private { vec!["private"] } else { Vec::<&str>::new() },
            "source_hash": sha256(snippet.as_bytes()),
            "structural_hash": structural_hash,
            "structural_features": features,
            "structure": {
                "head": head,
                "normalized": normalize_form(snippet)
            }
        }));
    }

    let mut references = form_vector(&output[3])?
        .iter()
        .map(|reference| {
            let values = form_vector(reference)?;
            if values.len() != 2 {
                return Err(format!("reference has {} fields", values.len()));
            }
            let definition_index = form_number(&values[0])?;
            let target = tree.tokens.get(form_number(&values[1])?)?;
            let candidate = target.contains('/');
            Ok(json!({
                "kind": "call",
                "range": source_range(source, 0, 0),
                "source_symbol_local_id": format!("symbol-{definition_index}"),
                "target_text": target,
                "resolution": if candidate { "candidate" } else { "unresolved" },
                "confidence": if candidate { 0.7 } else { 0.3 }
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    references.sort_by(|left, right| {
        let left_key = (
            left.get("source_symbol_local_id")
                .and_then(JsonValue::as_str)
                .unwrap_or(""),
            left.get("target_text")
                .and_then(JsonValue::as_str)
                .unwrap_or(""),
        );
        let right_key = (
            right
                .get("source_symbol_local_id")
                .and_then(JsonValue::as_str)
                .unwrap_or(""),
            right
                .get("target_text")
                .and_then(JsonValue::as_str)
                .unwrap_or(""),
        );
        left_key.cmp(&right_key)
    });

    let mut file = JsonMap::new();
    file.insert("language".into(), JsonValue::String(language.to_owned()));
    file.insert("path".into(), JsonValue::String(path.to_owned()));
    file.insert("blob_oid".into(), JsonValue::String(blob_oid.to_owned()));
    file.insert("namespace".into(), namespace);
    file.insert("imports".into(), JsonValue::Array(imports));
    file.insert("source_bytes".into(), JsonValue::from(source.len()));

    Ok(json!({
        "file": file,
        "symbols": symbols,
        "references": references,
        "diagnostics": []
    }))
}

fn node(nodes: &[HostNode], index: i64) -> Result<&HostNode, String> {
    usize::try_from(index)
        .ok()
        .and_then(|index| nodes.get(index))
        .ok_or_else(|| format!("unknown node index {index}"))
}

fn form_vector(form: &Form) -> Result<&[Form], String> {
    match form {
        Form::Vector(values) => Ok(values),
        other => Err(format!("expected encoded vector, got {other}")),
    }
}

fn form_number(form: &Form) -> Result<i64, String> {
    match form {
        Form::Number(value) => Ok(*value),
        other => Err(format!("expected encoded integer, got {other}")),
    }
}

fn definition_kind(kind: i64) -> Result<&'static str, String> {
    match kind {
        1 => Ok("variable"),
        2 => Ok("function"),
        3 => Ok("macro"),
        4 => Ok("multimethod"),
        5 => Ok("method"),
        6 => Ok("protocol"),
        7 => Ok("record"),
        8 => Ok("type"),
        9 => Ok("test"),
        _ => Err(format!("unknown definition kind {kind}")),
    }
}

fn required_string<'a>(
    request: &'a JsonValue,
    key: &str,
    allow_empty: bool,
) -> Result<&'a str, AnalyzerFailure> {
    let value = request.get(key).and_then(JsonValue::as_str).ok_or_else(|| {
        AnalyzerFailure::new(
            "invalid_request",
            format!("missing or invalid field: {key}"),
        )
    })?;
    if !allow_empty && value.trim().is_empty() {
        return Err(AnalyzerFailure::new(
            "invalid_request",
            format!("missing or invalid field: {key}"),
        ));
    }
    Ok(value)
}

fn source_range(source: &str, start: usize, end: usize) -> JsonValue {
    json!({
        "start_byte": start,
        "end_byte": end,
        "start": position(source, start),
        "end": position(source, end)
    })
}

fn position(source: &str, offset: usize) -> JsonValue {
    let prefix = source.get(..offset).unwrap_or(source);
    let mut lines = prefix.split('\n');
    let mut line = 0usize;
    let mut last = "";
    for value in lines.by_ref() {
        line += 1;
        last = value;
    }
    json!({
        "line": line.max(1),
        "column": last.encode_utf16().count() + 1
    })
}

fn normalize_form(source: &str) -> String {
    let mut without_comments = String::with_capacity(source.len());
    for line in source.split_inclusive('\n') {
        let (body, newline) = line
            .strip_suffix('\n')
            .map(|body| (body, "\n"))
            .unwrap_or((line, ""));
        let body = body
            .split_once(';')
            .map(|(before, _)| before)
            .unwrap_or(body);
        without_comments.push_str(body);
        without_comments.push_str(newline);
    }
    let mut output = String::new();
    let mut whitespace = false;
    for character in without_comments.chars() {
        if character.is_whitespace() {
            whitespace = true;
        } else {
            if whitespace && !output.is_empty() {
                output.push(' ');
            }
            whitespace = false;
            output.push(character);
        }
    }
    output.trim().to_owned()
}

fn sha256(value: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(value);
    format!("{:x}", digest.finalize())
}

#[derive(Debug)]
pub struct AnalyzerFailure {
    pub code: &'static str,
    pub message: String,
}

impl AnalyzerFailure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn analyzer_fingerprint() -> String {
    let mut digest = Sha256::new();
    digest.update(include_bytes!("../analyzer.hal"));
    digest.update(include_bytes!("engine.rs"));
    digest.update(include_bytes!("shape.rs"));
    digest.update(env!("CARGO_PKG_VERSION").as_bytes());
    digest.update(env!("HISTORIA_HARA_RUNTIME_REV").as_bytes());
    digest.update(b"hara-rust-full:whole-wasm:hta1-boundary-v1");
    format!("{:x}", digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_matches_the_reference_analyzer_contract() {
        assert_eq!(
            normalize_form("(defn answer ; comment\n  [x]\n  (+ x 1))"),
            "(defn answer [x] (+ x 1))"
        );
    }

    #[test]
    fn utf16_display_columns_match_the_babashka_worker() {
        assert_eq!(position("😀x", 4), json!({"line": 1, "column": 3}));
    }
}
