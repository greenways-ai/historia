#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SINGLE_BENCHMARK = path.join(ROOT, "benchmarks", "clojure-analyzers.js");
const GENERATED_DEFINITIONS = 480;
const FIXED_SHAPE_FIXTURES = 3;

const PROFILES = [
  { id: "many-small", label: "Many small files", files: 24, definitions: 20 },
  { id: "balanced", label: "Balanced", files: 6, definitions: 80 },
  { id: "few-large", label: "Few large files", files: 2, definitions: 240 },
];

function parseArgs(argv) {
  const options = {
    warmup: 2,
    iterations: 8,
    coldRuns: 5,
    outputDir: "target/clojure-analyzer-benchmarks",
    summarizeOnly: false,
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
      case "--output-dir": options.outputDir = value(); break;
      case "--summarize-only": options.summarizeOnly = true; break;
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
  console.log(`Usage: bun benchmarks/clojure-analyzer-matrix.js [options]\n\n`
    + `  --warmup N          Untimed warmup cycles per profile (default: 2)\n`
    + `  --iterations N      Timed cycles per profile (default: 8)\n`
    + `  --cold-runs N       Fresh-process samples per profile (default: 5)\n`
    + `  --output-dir DIR    Report directory (default: target/clojure-analyzer-benchmarks)\n`
    + `  --summarize-only    Rebuild the summary from existing profile JSON files`);
}

async function execute(program, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `Benchmark process failed (code=${code}, signal=${signal}): ${program} ${args.join(" ")}`,
      ));
    });
  });
}

function generatedFile(profile, file) {
  const definitions = [];
  for (let index = 0; index < profile.definitions; index++) {
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
  return `(ns benchmark.generated.file${file}\n`
    + `  (:require [clojure.string :as str]\n`
    + `            [clojure.set :as set]))\n\n`
    + `${definitions.join("\n\n")}\n`;
}

async function writeProfileCorpus(profile, outputDir) {
  const corpusDir = path.join(outputDir, "corpora", profile.id);
  await fs.rm(corpusDir, { recursive: true, force: true });
  await fs.mkdir(corpusDir, { recursive: true });
  for (let file = 0; file < profile.files; file++) {
    await fs.writeFile(
      path.join(corpusDir, `file_${file}.clj`),
      generatedFile(profile, file),
    );
  }
  return path.relative(ROOT, corpusDir).split(path.sep).join("/");
}

async function runProfile(profile, options, outputDir) {
  const json = path.join(outputDir, `${profile.id}.json`);
  const markdown = path.join(outputDir, `${profile.id}.md`);
  const corpus = await writeProfileCorpus(profile, outputDir);
  console.log(`\n=== ${profile.label}: ${profile.files} files × ${profile.definitions} definitions ===\n`);
  await execute(process.execPath, [
    SINGLE_BENCHMARK,
    "--corpus", corpus,
    "--warmup", String(options.warmup),
    "--iterations", String(options.iterations),
    "--cold-runs", String(options.coldRuns),
    "--json", json,
    "--markdown", markdown,
  ]);
}

async function loadProfile(profile, outputDir) {
  const file = path.join(outputDir, `${profile.id}.json`);
  const report = JSON.parse(await fs.readFile(file, "utf8"));
  if (!report.response_shape?.ok) {
    throw new Error(`${profile.label} did not pass the response-shape smoke test`);
  }
  return { profile, report };
}

function summaryEntry(profile, report) {
  return {
    id: profile.id,
    label: profile.label,
    generated_files: profile.files,
    definitions_per_file: profile.definitions,
    generated_definitions: profile.files * profile.definitions,
    corpus: report.corpus,
    shape_checks: report.response_shape.total,
    cold_ms: {
      babashka_p50: report.cold.babashka.summary.p50,
      hara_p50: report.cold.hara.summary.p50,
      hara_advantage: report.advantage.cold_p50,
    },
    warm_ms: {
      babashka_p50: report.warm.babashka.latency.p50,
      hara_p50: report.warm.hara.latency.p50,
      p50_hara_advantage: report.advantage.warm_p50,
      babashka_p95: report.warm.babashka.latency.p95,
      hara_p95: report.warm.hara.latency.p95,
      p95_hara_advantage: report.advantage.warm_p95,
    },
    throughput: {
      babashka_files_per_second: report.warm.babashka.files_per_second,
      hara_files_per_second: report.warm.hara.files_per_second,
      files_per_second_hara_advantage: report.advantage.files_per_second,
      babashka_mib_per_second: report.warm.babashka.mib_per_second,
      hara_mib_per_second: report.warm.hara.mib_per_second,
      mib_per_second_hara_advantage: report.advantage.mib_per_second,
    },
  };
}

function markdown(entries, options) {
  const lines = [
    "## Hara `hara-rust-full` analyzer scale benchmark",
    "",
    `Response-shape smoke: **PASS across all ${entries.length} timed corpus shapes**.`,
    "",
    `Each timed profile contains ${GENERATED_DEFINITIONS} generated definitions. `
      + `The ${FIXED_SHAPE_FIXTURES} fixed Clojure/Babashka shape fixtures run separately `
      + `through \`analyzer:shape\` and are excluded from timing. Only generated file `
      + `granularity changes. Measurements use ${options.warmup} warmup, `
      + `${options.iterations} timed, and ${options.coldRuns} fresh-process cycles per profile.`,
    "",
    "### Cold start",
    "",
    "| Corpus shape | Generated layout | Timed files | Source/cycle | Babashka p50 | Hara p50 | Hara advantage |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.label} | ${entry.generated_files} × ${entry.definitions_per_file} defs `
        + `| ${entry.corpus.files} | ${formatBytes(entry.corpus.bytes)} `
        + `| ${formatMs(entry.cold_ms.babashka_p50)} | ${formatMs(entry.cold_ms.hara_p50)} `
        + `| ${formatRatio(entry.cold_ms.hara_advantage)} |`,
    );
  }
  lines.push(
    "",
    "### Warm request latency",
    "",
    "| Corpus shape | Babashka p50 | Hara p50 | p50 advantage | Babashka p95 | Hara p95 | p95 advantage |",
    "|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const entry of entries) {
    lines.push(
      `| ${entry.label} | ${formatMs(entry.warm_ms.babashka_p50)} `
        + `| ${formatMs(entry.warm_ms.hara_p50)} `
        + `| ${formatRatio(entry.warm_ms.p50_hara_advantage)} `
        + `| ${formatMs(entry.warm_ms.babashka_p95)} `
        + `| ${formatMs(entry.warm_ms.hara_p95)} `
        + `| ${formatRatio(entry.warm_ms.p95_hara_advantage)} |`,
    );
  }
  lines.push(
    "",
    "### Warm throughput",
    "",
    "| Corpus shape | Babashka files/s | Hara files/s | File-rate advantage | Babashka MiB/s | Hara MiB/s | Byte-rate advantage |",
    "|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const entry of entries) {
    lines.push(
      `| ${entry.label} | ${formatNumber(entry.throughput.babashka_files_per_second, 1)} `
        + `| ${formatNumber(entry.throughput.hara_files_per_second, 1)} `
        + `| ${formatRatio(entry.throughput.files_per_second_hara_advantage)} `
        + `| ${formatNumber(entry.throughput.babashka_mib_per_second, 2)} `
        + `| ${formatNumber(entry.throughput.hara_mib_per_second, 2)} `
        + `| ${formatRatio(entry.throughput.mib_per_second_hara_advantage)} |`,
    );
  }
  lines.push(
    "",
    "Cold start measures a fresh process through its first `describe` response. Warm requests use persistent workers, alternate execution order by cycle, and include complete response materialization. The gate compares response structure and JSON types, not analyzer values, so Hara can retain semantically richer keyword and string shapes.",
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

function formatNumber(value, places) {
  return value == null ? "n/a" : value.toFixed(places);
}

function formatBytes(value) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(2)} MiB`
    : `${(value / 1024).toFixed(1)} KiB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(ROOT, options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  for (const profile of PROFILES) {
    if (profile.files * profile.definitions !== GENERATED_DEFINITIONS) {
      throw new Error(`${profile.id} does not contain ${GENERATED_DEFINITIONS} definitions`);
    }
    if (!options.summarizeOnly) {
      await runProfile(profile, options, outputDir);
    }
  }

  const loaded = await Promise.all(PROFILES.map((profile) => loadProfile(profile, outputDir)));
  const entries = loaded.map(({ profile, report }) => summaryEntry(profile, report));
  const summary = {
    generated_at: new Date().toISOString(),
    invariant: {
      generated_definitions_per_profile: GENERATED_DEFINITIONS,
      fixed_shape_fixtures_smoked_separately: FIXED_SHAPE_FIXTURES,
    },
    options: {
      warmup: options.warmup,
      iterations: options.iterations,
      cold_runs: options.coldRuns,
    },
    profiles: entries,
  };
  const summaryJson = path.join(outputDir, "summary.json");
  const summaryMarkdown = path.join(outputDir, "summary.md");
  await fs.writeFile(summaryJson, `${JSON.stringify(summary, null, 2)}\n`);
  const rendered = markdown(entries, options);
  await fs.writeFile(summaryMarkdown, rendered);
  process.stdout.write(`\n${rendered}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
