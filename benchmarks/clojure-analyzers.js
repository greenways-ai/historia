#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BB = ["bb", "-cp", "analyzers/clojure/src", "-m", "greenways-historian.analyzer"];
const DEFAULT_HARA = ["analyzers/hara/target/release/historia-hara-analyzer"];

class Worker {
  constructor(name, command) {
    this.name = name;
    this.command = command;
    this.child = null;
    this.pending = [];
    this.stderr = "";
    this.closed = false;
  }

  start() {
    if (this.child) return;
    const [program, ...args] = this.command;
    this.child = spawn(program, args, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-128 * 1024);
    });
    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const pending = this.pending.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      try {
        pending.resolve(JSON.parse(line));
      } catch (error) {
        pending.reject(new Error(`${this.name} emitted invalid JSON: ${line}`, { cause: error }));
      }
    });
    this.child.on("error", (error) => this.failPending(error));
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      const detail = this.stderr ? `\n${this.stderr}` : "";
      this.failPending(new Error(`${this.name} exited (code=${code}, signal=${signal})${detail}`));
    });
  }

  request(request, timeoutMs = 30_000) {
    this.start();
    if (this.closed || !this.child?.stdin?.writable) {
      return Promise.reject(new Error(`${this.name} is not writable`));
    }
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, timer: null };
      pending.timer = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error(`${this.name} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.push(pending);
      this.child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(pending.timer);
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(error);
      });
    });
  }

  failPending(error) {
    while (this.pending.length) {
      const pending = this.pending.shift();
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  async stop() {
    if (!this.child || this.closed) return;
    try {
      await this.request(envelope("shutdown", `${this.name}-shutdown`), 5_000);
    } catch {
      this.child.kill("SIGTERM");
    }
    if (!this.closed) {
      await Promise.race([
        once(this.child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    if (!this.closed) this.child.kill("SIGKILL");
  }
}

function envelope(op, requestId) {
  return { protocol_version: "1.0", request_id: requestId, op };
}

function parseArgs(argv) {
  const options = {
    warmup: 2,
    iterations: 8,
    coldRuns: 3,
    files: 6,
    definitions: 80,
    corpus: null,
    json: null,
    markdown: null,
    shapeOnly: false,
    bbCommand: process.env.HISTORIA_BB_ANALYZER || null,
    haraCommand: process.env.HISTORIA_HARA_ANALYZER || null,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      if (++index >= argv.length) throw new Error(`Missing value for ${argument}`);
      return argv[index];
    };
    switch (argument) {
      case "--warmup": options.warmup = integer(value(), argument); break;
      case "--iterations": options.iterations = integer(value(), argument); break;
      case "--cold-runs": options.coldRuns = integer(value(), argument); break;
      case "--files": options.files = integer(value(), argument); break;
      case "--definitions": options.definitions = integer(value(), argument); break;
      case "--corpus": options.corpus = value(); break;
      case "--json": options.json = value(); break;
      case "--markdown": options.markdown = value(); break;
      case "--bb-command": options.bbCommand = value(); break;
      case "--hara-command": options.haraCommand = value(); break;
      case "--shape-only": options.shapeOnly = true; break;
      case "--help": printHelp(); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function integer(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: bun benchmarks/clojure-analyzers.js [options]\n\n`
    + `  --corpus DIR           Analyze .clj and .bb files beneath DIR\n`
    + `  --files N              Generated performance files (default: 6)\n`
    + `  --definitions N        Definitions per generated file (default: 80)\n`
    + `  --warmup N             Untimed warmup cycles (default: 2)\n`
    + `  --iterations N         Timed cycles (default: 8)\n`
    + `  --cold-runs N          Process startup samples (default: 3)\n`
    + `  --shape-only           Compare response shapes without timings\n`
    + `  --json FILE            Write machine-readable results\n`
    + `  --markdown FILE        Write a Markdown summary\n`
    + `  --bb-command COMMAND   Override the Babashka command\n`
    + `  --hara-command COMMAND Override the Hara command`);
}

function command(value, fallback) {
  return value ? shellWords(value) : fallback;
}

function shellWords(source) {
  const words = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) words.push(current), current = "";
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Unterminated quote in analyzer command");
  if (escaped) current += "\\";
  if (current) words.push(current);
  if (!words.length) throw new Error("Analyzer command is empty");
  return words;
}

async function loadCorpus(options) {
  if (!options.corpus) {
    return [...shapeFixtures(), ...generatedCorpus(options.files, options.definitions)];
  }
  const root = path.resolve(ROOT, options.corpus);
  const sources = [];
  for (const file of (await walk(root)).sort()) {
    if (!file.endsWith(".clj") && !file.endsWith(".bb")) continue;
    sources.push({
      path: path.relative(root, file).split(path.sep).join("/"),
      source: await fs.readFile(file, "utf8"),
      language: file.endsWith(".bb") ? "babashka" : "clojure",
    });
  }
  if (!sources.length) throw new Error(`No .clj or .bb files found under ${root}`);
  return sources;
}

async function walk(root) {
  const output = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function shapeFixtures() {
  return [
    {
      path: "shape/language_surface.clj",
      language: "clojure",
      source: `(ns shape.language-surface
  (:require [clojure.string :as str]
            [example.math :as math]))

(def answer 42)
(defonce cached {:status :ready})
(defn- hidden [x] (math/inc x))
(defn привет
  [value]
  (let [label "semi;colon"]
    (str/upper-case label)
    (hidden value)))
(defmacro with-answer [body] \`(let [answer# 42] ~body))
(defmulti render type)
(defmethod render :default [value] (str value))
(defprotocol IExample (run [this input]))
(defrecord Example [value])
(deftype Wrapped [value])
(deftest analyzer-test (is (= 42 answer)))
`,
    },
    {
      path: "shape/reader_forms.bb",
      language: "babashka",
      source: `(ns shape.reader-forms
  (:require [clojure.set :as set]))

(defn quoted [value]
  (do
    @value
    '(:a :b)
    \`(set/union #{:a} ~value)
    (qualified/call value)
    (plain-call value)))
`,
    },
    {
      path: "shape/ranges.clj",
      language: "clojure",
      source: `(ns shape.ranges (:require [alpha.beta :as alpha]))

(defn same-name [x]
  (alpha/step x))

(defn same-name-again [x]
  (same-name x))
`,
    },
  ];
}

function generatedCorpus(fileCount, definitionCount) {
  const files = [];
  for (let file = 0; file < fileCount; file++) {
    const definitions = [];
    for (let index = 0; index < definitionCount; index++) {
      definitions.push(`(defn worker-${file}-${index}\n`
        + `  [value context]\n`
        + `  (let [next-value (inc value)\n`
        + `        label (str "item-${file}-${index}-" next-value)\n`
        + `        attrs {:file ${file} :index ${index} :active true}\n`
        + `        values [value next-value]]\n`
        + `    (if (odd? next-value)\n`
        + `      (assoc context :label label :attrs attrs :values values)\n`
        + `      (update context :total + next-value))))`);
    }
    files.push({
      path: `generated/file_${file}.clj`,
      language: "clojure",
      source: `(ns benchmark.generated.file${file}\n`
        + `  (:require [clojure.string :as str]\n`
        + `            [clojure.set :as set]))\n\n`
        + `${definitions.join("\n\n")}\n`,
    });
  }
  return files;
}

function requestsFor(corpus) {
  return corpus.map((file, index) => ({
    ...envelope("analyze", `shape-analyze-${index}`),
    language: file.language,
    path: file.path,
    blob_oid: createHash("sha1").update(file.source).digest("hex"),
    source: file.source,
    config: {},
  }));
}

function scalarKind(value) {
  if (value === null) return "null";
  const kind = typeof value;
  return kind === "number" ? "number" : kind;
}

function shapeDescriptor(value) {
  if (Array.isArray(value)) {
    const seen = new Set();
    const items = [];
    for (const item of value) {
      const descriptor = shapeDescriptor(item);
      const key = JSON.stringify(descriptor);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(descriptor);
      }
    }
    items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { kind: "array", items };
  }
  if (value && typeof value === "object") {
    return {
      kind: "object",
      fields: Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, shapeDescriptor(value[key])]),
      ),
    };
  }
  return { kind: scalarKind(value) };
}

function isScalarDescriptor(descriptor) {
  return !["array", "object"].includes(descriptor.kind);
}

function descriptorsCompatible(left, right) {
  return descriptorDifference(left, right) === null;
}

function descriptorDifference(left, right, pathParts = []) {
  if (left.kind !== right.kind) {
    if ((left.kind === "null" && isScalarDescriptor(right))
      || (right.kind === "null" && isScalarDescriptor(left))) {
      return null;
    }
    return {
      path: pathParts.join("."),
      babashka: left,
      hara: right,
      kind: "type",
    };
  }
  if (left.kind === "object") {
    const keys = [...new Set([
      ...Object.keys(left.fields),
      ...Object.keys(right.fields),
    ])].sort();
    for (const key of keys) {
      if (!(key in left.fields) || !(key in right.fields)) {
        return {
          path: [...pathParts, key].join("."),
          babashka: left.fields[key] ?? null,
          hara: right.fields[key] ?? null,
          kind: "missing-field",
        };
      }
      const difference = descriptorDifference(
        left.fields[key],
        right.fields[key],
        [...pathParts, key],
      );
      if (difference) return difference;
    }
  }
  if (left.kind === "array") {
    if (!left.items.length || !right.items.length) return null;
    for (const item of left.items) {
      if (!right.items.some((candidate) => descriptorsCompatible(item, candidate))) {
        return {
          path: [...pathParts, "[]"].join("."),
          babashka: item,
          hara: right.items,
          kind: "array-item-shape",
        };
      }
    }
    for (const item of right.items) {
      if (!left.items.some((candidate) => descriptorsCompatible(candidate, item))) {
        return {
          path: [...pathParts, "[]"].join("."),
          babashka: left.items,
          hara: item,
          kind: "array-item-shape",
        };
      }
    }
  }
  return null;
}

async function responseShapeSmoke(bb, hara, analyzeRequests) {
  const requests = [
    envelope("describe", "shape-describe"),
    envelope("ping", "shape-ping"),
    ...analyzeRequests,
  ];
  const mismatches = [];
  let checked = 0;
  for (const request of requests) {
    const [bbResponse, haraResponse] = await Promise.all([
      bb.request(request),
      hara.request(request),
    ]);
    ensureResult(bbResponse, `babashka ${request.op}`);
    ensureResult(haraResponse, `hara-rust-full ${request.op}`);
    checked++;
    const bbShape = shapeDescriptor(bbResponse);
    const haraShape = shapeDescriptor(haraResponse);
    const difference = descriptorDifference(bbShape, haraShape);
    if (difference) {
      mismatches.push({
        request: request.op === "analyze" ? request.path : request.op,
        difference,
      });
      if (mismatches.length >= 3) break;
    }
  }
  return {
    ok: mismatches.length === 0,
    checked,
    total: requests.length,
    analyzed_files: analyzeRequests.length,
    mismatches,
  };
}

function ensureResult(response, label) {
  if (response?.result) return response.result;
  throw new Error(`${label} failed: ${JSON.stringify(response?.error || response)}`);
}

async function coldStart(name, commandLine, runs) {
  const samples = [];
  let describe = null;
  for (let run = 0; run < runs; run++) {
    const worker = new Worker(`${name}-cold-${run}`, commandLine);
    const started = performance.now();
    const response = await worker.request(envelope("describe", `${name}-cold-${run}`));
    samples.push(performance.now() - started);
    describe = ensureResult(response, `${name} describe`);
    await worker.stop();
  }
  return { samples, summary: summarize(samples), describe };
}

async function runBatch(worker, requests, collectLatencies) {
  const latencies = [];
  const started = performance.now();
  for (const request of requests) {
    const requestStarted = performance.now();
    ensureResult(await worker.request(request), `${worker.name} ${request.path}`);
    if (collectLatencies) latencies.push(performance.now() - requestStarted);
  }
  return { duration: performance.now() - started, latencies };
}

async function warmBenchmark(bb, hara, requests, options) {
  for (let cycle = 0; cycle < options.warmup; cycle++) {
    for (const worker of cycle % 2 === 0 ? [bb, hara] : [hara, bb]) {
      await runBatch(worker, requests, false);
    }
  }
  const measurements = {
    babashka: { duration: 0, latencies: [] },
    hara: { duration: 0, latencies: [] },
  };
  for (let cycle = 0; cycle < options.iterations; cycle++) {
    const order = cycle % 2 === 0
      ? [["babashka", bb], ["hara", hara]]
      : [["hara", hara], ["babashka", bb]];
    for (const [name, worker] of order) {
      const batch = await runBatch(worker, requests, true);
      measurements[name].duration += batch.duration;
      measurements[name].latencies.push(...batch.latencies);
    }
  }
  const bytesPerCycle = requests.reduce(
    (total, request) => total + Buffer.byteLength(request.source, "utf8"),
    0,
  );
  for (const measurement of Object.values(measurements)) {
    const seconds = measurement.duration / 1000;
    const totalFiles = requests.length * options.iterations;
    const totalBytes = bytesPerCycle * options.iterations;
    measurement.latency = summarize(measurement.latencies);
    measurement.files_per_second = seconds ? totalFiles / seconds : 0;
    measurement.mib_per_second = seconds ? totalBytes / (1024 * 1024) / seconds : 0;
    measurement.total_ms = measurement.duration;
    delete measurement.duration;
  }
  return measurements;
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    min: sorted.at(0) ?? null,
    mean: sorted.length ? total / sorted.length : null,
    p50: percentile(0.50),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? null,
  };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function markdown(report) {
  const smoke = report.response_shape;
  const lines = [
    "## Hara `hara-rust-full` analyzer benchmark",
    "",
    `Response-shape smoke: **${smoke.ok ? `PASS (${smoke.checked}/${smoke.total} checks)` : "FAIL"}**`,
    "",
  ];
  if (!smoke.ok) {
    const mismatch = smoke.mismatches[0];
    lines.push(
      `First mismatch: \`${mismatch.request}\` at `
        + `\`${mismatch.difference?.path || "<root>"}\`.`,
      "",
    );
    return `${lines.join("\n")}\n`;
  }
  if (!report.warm) {
    lines.push("Timing was skipped (`--shape-only`).", "");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `Corpus: ${report.corpus.files} files, ${formatBytes(report.corpus.bytes)} per cycle; `
      + `${report.options.warmup} warmup and ${report.options.iterations} timed cycles.`,
    "",
    "| Metric | Babashka | Hara `rust-full` | Hara advantage |",
    "|---|---:|---:|---:|",
    `| Cold start p50 | ${formatMs(report.cold.babashka.summary.p50)} | ${formatMs(report.cold.hara.summary.p50)} | ${formatRatio(report.advantage.cold_p50)} |`,
    `| Warm request p50 | ${formatMs(report.warm.babashka.latency.p50)} | ${formatMs(report.warm.hara.latency.p50)} | ${formatRatio(report.advantage.warm_p50)} |`,
    `| Warm request p95 | ${formatMs(report.warm.babashka.latency.p95)} | ${formatMs(report.warm.hara.latency.p95)} | ${formatRatio(report.advantage.warm_p95)} |`,
    `| Throughput | ${report.warm.babashka.files_per_second.toFixed(1)} files/s | ${report.warm.hara.files_per_second.toFixed(1)} files/s | ${formatRatio(report.advantage.files_per_second)} |`,
    `| Source throughput | ${report.warm.babashka.mib_per_second.toFixed(2)} MiB/s | ${report.warm.hara.mib_per_second.toFixed(2)} MiB/s | ${formatRatio(report.advantage.mib_per_second)} |`,
    "",
    "The smoke check compares protocol keys, container structure, and scalar types. It intentionally does not require identical analyzer content; Hara may preserve richer reader distinctions than the Babashka/rewrite-clj backend.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function formatMs(value) {
  return value == null ? "n/a" : `${value.toFixed(2)} ms`;
}

function formatRatio(value) {
  return value == null ? "n/a" : `${value.toFixed(2)}×`;
}

function formatBytes(value) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(2)} MiB`
    : `${(value / 1024).toFixed(1)} KiB`;
}

async function writeReport(report, options) {
  if (options.json) {
    const target = path.resolve(ROOT, options.json);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  const summary = markdown(report);
  if (options.markdown) {
    const target = path.resolve(ROOT, options.markdown);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, summary);
  }
  process.stdout.write(summary);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = await loadCorpus(options);
  const analyzeRequests = requestsFor(corpus);
  const bbCommand = command(options.bbCommand, DEFAULT_BB);
  const haraCommand = command(options.haraCommand, DEFAULT_HARA);
  const bb = new Worker("babashka", bbCommand);
  const hara = new Worker("hara-rust-full", haraCommand);
  try {
    const responseShape = await responseShapeSmoke(bb, hara, analyzeRequests);
    const report = {
      generated_at: new Date().toISOString(),
      options: {
        warmup: options.warmup,
        iterations: options.iterations,
        cold_runs: options.coldRuns,
        shape_only: options.shapeOnly,
      },
      commands: { babashka: bbCommand, hara: haraCommand },
      corpus: {
        files: corpus.length,
        bytes: corpus.reduce((total, file) => total + Buffer.byteLength(file.source, "utf8"), 0),
      },
      response_shape: responseShape,
    };
    if (!responseShape.ok) {
      await writeReport(report, options);
      process.exitCode = 1;
      return;
    }
    if (!options.shapeOnly) {
      const [bbCold, haraCold] = await Promise.all([
        coldStart("babashka", bbCommand, options.coldRuns),
        coldStart("hara-rust-full", haraCommand, options.coldRuns),
      ]);
      const warm = await warmBenchmark(bb, hara, analyzeRequests, options);
      report.cold = { babashka: bbCold, hara: haraCold };
      report.warm = warm;
      report.advantage = {
        cold_p50: ratio(bbCold.summary.p50, haraCold.summary.p50),
        warm_p50: ratio(warm.babashka.latency.p50, warm.hara.latency.p50),
        warm_p95: ratio(warm.babashka.latency.p95, warm.hara.latency.p95),
        files_per_second: ratio(warm.hara.files_per_second, warm.babashka.files_per_second),
        mib_per_second: ratio(warm.hara.mib_per_second, warm.babashka.mib_per_second),
      };
    }
    await writeReport(report, options);
  } finally {
    await Promise.allSettled([bb.stop(), hara.stop()]);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
