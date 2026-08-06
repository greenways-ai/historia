#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_ROOT="${NETLIFY_CACHE_DIR:-$ROOT/.netlify-cache}"
TOOLS="$CACHE_ROOT/hara-benchmark-tools"
REPORTS="$ROOT/target/clojure-analyzer-netlify"
PUBLIC_REPORTS="$ROOT/site/public/analyzer-benchmark"

mkdir -p "$TOOLS/bin" "$REPORTS"
export PATH="$HOME/.cargo/bin:$TOOLS/bin:$PATH"
cd "$ROOT"

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 --retry 5 --retry-all-errors -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="$HOME/.cargo/bin:$TOOLS/bin:$PATH"

if ! command -v bb >/dev/null 2>&1; then
  BB_ARCHIVE="$TOOLS/babashka-1.12.218-linux-amd64-static.tar.gz"
  curl -fL --retry 5 --retry-all-errors \
    https://github.com/babashka/babashka/releases/download/v1.12.218/babashka-1.12.218-linux-amd64-static.tar.gz \
    -o "$BB_ARCHIVE"
  echo "7bd028cc794732ffde3da31ce4379840893c8e54f1046f92a8dfc4f4b3cddaf8  $BB_ARCHIVE" \
    | sha256sum -c -
  tar -xzf "$BB_ARCHIVE" -C "$TOOLS/bin" bb
  chmod +x "$TOOLS/bin/bb"
fi

rm -rf "$REPORTS" "$PUBLIC_REPORTS"
mkdir -p "$REPORTS" "$PUBLIC_REPORTS"

{
  echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=${COMMIT_REF:-unknown}"
  echo "context=${CONTEXT:-unknown}"
  echo "runner=$(uname -a)"
  echo "node=$(node --version)"
  echo "cargo=$(cargo --version)"
  echo "rustc=$(rustc --version)"
  echo "babashka=$(bb --version)"
} | tee "$REPORTS/environment.txt"

cargo test --manifest-path analyzers/hara/Cargo.toml
cargo build --release --manifest-path analyzers/hara/Cargo.toml

node benchmarks/clojure-analyzers.js \
  --shape-only \
  --files 0 \
  --definitions 0 \
  --json "$REPORTS/shape-smoke.json" \
  --markdown "$REPORTS/shape-smoke.md"

node benchmarks/clojure-analyzer-matrix.js \
  --warmup 2 \
  --iterations 8 \
  --cold-runs 5 \
  --output-dir "$REPORTS"

cp -R "$REPORTS"/. "$PUBLIC_REPORTS"/
