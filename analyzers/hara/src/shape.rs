use crate::engine::Tokens;
use hara_wasm::kernel::Form;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Shape {
    Vector(Vec<Shape>),
    Keyword(String),
    String(String),
    Number(i64),
    Nil,
}

pub fn structural_features(encoded: &Form, tokens: &Tokens) -> Result<JsonValue, String> {
    let shape = decode_shape(encoded, tokens)?;
    let rendered = render(&shape);
    let nodes = descendants(&shape);
    let node_count = nodes.len();
    let depth = shape_depth(&shape);
    let arity = nodes
        .iter()
        .filter_map(|node| match node {
            Shape::Vector(values)
                if matches!(values.first(), Some(Shape::Keyword(value)) if value == "call") =>
            {
                Some(values.len().saturating_sub(1))
            }
            _ => None,
        })
        .max()
        .unwrap_or(0);
    let features = nodes
        .iter()
        .map(|node| render(node))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    Ok(json!({
        "shape": rendered,
        "shape_hash": sha256(&rendered),
        "node_count": node_count,
        "depth": depth,
        "arity": arity,
        "features": features
    }))
}

fn decode_shape(form: &Form, tokens: &Tokens) -> Result<Shape, String> {
    match form {
        Form::Nil => Ok(Shape::Nil),
        Form::Number(value) => Ok(Shape::Number(*value)),
        Form::Vector(values) => {
            if let Some(Form::Number(tag)) = values.first() {
                decode_tagged(*tag, &values[1..], tokens)
            } else {
                values
                    .iter()
                    .map(|value| decode_shape(value, tokens))
                    .collect::<Result<Vec<_>, _>>()
                    .map(Shape::Vector)
            }
        }
        other => Err(format!("invalid encoded structural shape: {other}")),
    }
}

fn decode_tagged(tag: i64, values: &[Form], tokens: &Tokens) -> Result<Shape, String> {
    let keyword = |name: &str| Shape::Keyword(name.to_owned());
    let vector = |values: Vec<Shape>| Shape::Vector(values);
    let one_child = |name: &str| -> Result<Shape, String> {
        let child = values.first().ok_or_else(|| format!("shape tag {tag} has no child"))?;
        Ok(vector(vec![keyword(name), decode_shape(child, tokens)?]))
    };
    let token = || -> Result<String, String> {
        let index = number(values.first().ok_or_else(|| format!("shape tag {tag} has no token"))?)?;
        tokens.get(index)
    };

    match tag {
        100 => Ok(vector(vec![keyword("special"), Shape::String(token()?)])),
        101 => Ok(vector(vec![keyword("call")])),
        102 => decode_collection("vector", values, tokens),
        103 => decode_collection("map", values, tokens),
        104 => decode_collection("set", values, tokens),
        105 => decode_collection("namespaced-map", values, tokens),
        106 => one_child("deref"),
        107 => one_child("quote"),
        108 => one_child("syntax-quote"),
        109 => one_child("unquote"),
        110 => one_child("unquote-splicing"),
        111 => Ok(vector(vec![keyword("keyword"), Shape::String(token()?)])),
        // rewrite-clj represents string literals as generic token nodes in the
        // structural analyzer, so they intentionally share [:symbol] here.
        112 => Ok(vector(vec![keyword("symbol")])),
        113 => Ok(vector(vec![keyword("number")])),
        114 => Ok(vector(vec![keyword("literal")])),
        115 => Ok(vector(vec![keyword("symbol")])),
        _ => Err(format!("unknown structural shape tag {tag}")),
    }
}

fn decode_collection(name: &str, values: &[Form], tokens: &Tokens) -> Result<Shape, String> {
    let mut decoded = vec![Shape::Keyword(name.to_owned())];
    for value in values {
        decoded.push(decode_shape(value, tokens)?);
    }
    Ok(Shape::Vector(decoded))
}

fn number(form: &Form) -> Result<i64, String> {
    match form {
        Form::Number(value) => Ok(*value),
        other => Err(format!("expected encoded integer, got {other}")),
    }
}

fn descendants<'a>(root: &'a Shape) -> Vec<&'a Shape> {
    fn walk<'a>(value: &'a Shape, output: &mut Vec<&'a Shape>) {
        output.push(value);
        if let Shape::Vector(values) = value {
            for child in values.iter().skip(1) {
                walk(child, output);
            }
        }
    }
    let mut output = Vec::new();
    walk(root, &mut output);
    output
}

fn shape_depth(value: &Shape) -> usize {
    match value {
        Shape::Vector(values) => {
            1 + values
                .iter()
                .skip(1)
                .map(shape_depth)
                .max()
                .unwrap_or(0)
        }
        _ => 1,
    }
}

fn render(value: &Shape) -> String {
    match value {
        Shape::Vector(values) => format!(
            "[{}]",
            values.iter().map(render).collect::<Vec<_>>().join(" ")
        ),
        Shape::Keyword(value) => format!(":{value}"),
        Shape::String(value) => clojure_string(value),
        Shape::Number(value) => value.to_string(),
        Shape::Nil => "nil".to_owned(),
    }
}

fn clojure_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000c}' => output.push_str("\\f"),
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            control if control.is_control() => {
                output.push_str(&format!("\\u{:04X}", control as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

fn sha256(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    format!("{:x}", digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_seq_metrics_skip_each_vector_tag_like_the_babashka_analyzer() {
        let shape = Shape::Vector(vec![
            Shape::Keyword("vector".into()),
            Shape::Vector(vec![Shape::Keyword("keyword".into()), Shape::String(":x".into())]),
        ]);
        let nodes = descendants(&shape);
        assert_eq!(nodes.len(), 3);
        assert_eq!(shape_depth(&shape), 3);
        assert_eq!(render(&shape), "[:vector [:keyword \":x\"]]");
    }

    #[test]
    fn string_tags_match_rewrite_clj_generic_token_shapes() {
        let tokens = Tokens::default();
        let encoded = Form::Vector(vec![Form::Number(112)]);
        let shape = decode_shape(&encoded, &tokens).expect("decode string shape");
        assert_eq!(shape, Shape::Vector(vec![Shape::Keyword("symbol".into())]));
        assert_eq!(render(&shape), "[:symbol]");

        let features = structural_features(&encoded, &tokens).expect("materialize features");
        assert_eq!(features["shape"], serde_json::json!("[:symbol]"));
        assert_eq!(features["features"], serde_json::json!(["[:symbol]"]));
        assert_eq!(features["node_count"], serde_json::json!(1));
        assert_eq!(features["depth"], serde_json::json!(1));
        assert_eq!(features["arity"], serde_json::json!(0));
    }
}
