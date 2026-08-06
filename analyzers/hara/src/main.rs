mod engine;
mod shape;

use engine::{analyzer_fingerprint, AnalyzerEngine, AnalyzerFailure};
use serde_json::{json, Value as JsonValue};
use std::io::{self, BufRead, Write};

const PROTOCOL_VERSION: &str = "1.0";
const ANALYZER_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MESSAGE_BYTES: usize = 10 * 1024 * 1024;

fn request_text<'a>(request: &'a JsonValue, key: &str, fallback: &'a str) -> &'a str {
    request.get(key).and_then(JsonValue::as_str).unwrap_or(fallback)
}

fn envelope(request: &JsonValue, key: &str, body: JsonValue) -> JsonValue {
    json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_text(request, "request_id", "unknown"),
        "op": request_text(request, "op", "unknown"),
        key: body
    })
}

fn result(request: &JsonValue, body: JsonValue) -> JsonValue {
    envelope(request, "result", body)
}

fn error(request: &JsonValue, code: &str, message: impl Into<String>) -> JsonValue {
    envelope(
        request,
        "error",
        json!({
            "code": code,
            "message": message.into()
        }),
    )
}

fn describe() -> JsonValue {
    json!({
        "name": "greenways-historian-hara-rust-full",
        "version": ANALYZER_VERSION,
        "protocol_versions": [PROTOCOL_VERSION],
        "languages": ["clojure", "babashka"],
        "extensions": [".clj", ".bb"],
        "capabilities": [
            "symbols",
            "calls",
            "structural_hashes",
            "structural_features",
            "partial_parse"
        ],
        "max_message_bytes": MAX_MESSAGE_BYTES,
        "fingerprint": analyzer_fingerprint()
    })
}

fn handle(engine: &mut AnalyzerEngine, request: &JsonValue) -> JsonValue {
    if request.get("protocol_version").and_then(JsonValue::as_str) != Some(PROTOCOL_VERSION) {
        return error(request, "invalid_request", "unsupported protocol version");
    }

    match request.get("op").and_then(JsonValue::as_str) {
        Some("describe") => result(request, describe()),
        Some("ping") => result(request, json!({"ok": true})),
        Some("shutdown") => result(request, json!({"ok": true})),
        Some("analyze") => match engine.analyze(request) {
            Ok(value) => result(request, value),
            Err(AnalyzerFailure { code, message }) => error(request, code, message),
        },
        _ => error(request, "unsupported_operation", "unsupported operation"),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut engine = AnalyzerEngine::new().map_err(io::Error::other)?;

    for line in stdin.lock().lines() {
        let line = line?;
        let request = serde_json::from_str::<JsonValue>(&line).unwrap_or_else(|_| {
            json!({
                "request_id": "unknown",
                "op": "unknown"
            })
        });
        let shutdown = request.get("op").and_then(JsonValue::as_str) == Some("shutdown");
        serde_json::to_writer(&mut stdout, &handle(&mut engine, &request))?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
        if shutdown {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_protocol_uses_the_reference_error_envelope() {
        let mut engine = AnalyzerEngine::new().expect("engine");
        let response = handle(
            &mut engine,
            &json!({"request_id": "x", "op": "ping", "protocol_version": "2"}),
        );
        assert_eq!(response["request_id"], "x");
        assert_eq!(response["error"]["code"], "invalid_request");
    }
}
