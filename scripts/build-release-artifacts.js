#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { COLLECT_EXTENSION_BUNDLE_SHA256 } from "../src/collect/extension-bundle.js";
import { CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID } from "../src/collect/extension-identity.js";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_OUTPUT = join(ROOT, "dist", "release");
const PACKAGE = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const TARGETS = Object.freeze([
  { slug: "linux-x64", bunTarget: "bun-linux-x64-baseline", archive: "tar.gz", executableSuffix: "" },
  { slug: "linux-arm64", bunTarget: "bun-linux-arm64", archive: "tar.gz", executableSuffix: "" },
  { slug: "darwin-x64", bunTarget: "bun-darwin-x64", archive: "tar.gz", executableSuffix: "" },
  { slug: "darwin-arm64", bunTarget: "bun-darwin-arm64", archive: "tar.gz", executableSuffix: "" },
  { slug: "windows-x64", bunTarget: "bun-windows-x64-baseline", archive: "zip", executableSuffix: ".exe" },
  { slug: "windows-arm64", bunTarget: "bun-windows-arm64", archive: "zip", executableSuffix: ".exe" }
]);

const ENTRIES = Object.freeze([
  { name: "gw-historian", source: "src/cli.js" },
  { name: "historia", source: "src/historia-cli.js" },
  { name: "historia-collect", source: "src/collect/install-entry.js" },
  { name: "historia-collect-host", source: "src/collect/native-entry.js" }
]);

const SUPPORT_DIRECTORIES = Object.freeze(["analyzers", "docs", "skills", "spec"]);
const SUPPORT_FILES = Object.freeze([
  "bb.edn",
  "greenways-historian.example.json",
  "package.json",
  "README.md",
  "LICENSE"
]);

function usage() {
  console.log(`Build Historia release artifacts

Usage:
  bun scripts/build-release-artifacts.js [options]

Options:
  --version <version>       Release version; defaults to package.json
  --output <directory>      Output directory; defaults to dist/release
  --target <slug>           Build one target; repeat for more targets
  --smoke-target <slug>     Execute smoke tests for this runnable target
  --no-smoke                Disable automatic host-platform smoke tests
  --keep-stage              Retain the temporary staging directory
  --help                    Show this help

Targets:
  ${TARGETS.map((target) => target.slug).join("\n  ")}
`);
}

function run(command, args, { cwd = ROOT, env = process.env, quiet = false } = {}) {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env,
    stdout: quiet ? "pipe" : "inherit",
    stderr: quiet ? "pipe" : "inherit"
  });
  if (result.exitCode !== 0) {
    const stdout = quiet ? new TextDecoder().decode(result.stdout) : "";
    const stderr = quiet ? new TextDecoder().decode(result.stderr) : "";
    throw new Error(`${command} ${args.join(" ")} failed (${result.exitCode})${stderr || stdout ? `: ${(stderr || stdout).trim()}` : ""}`);
  }
  return quiet ? new TextDecoder().decode(result.stdout).trim() : "";
}

function selectedTargets(values) {
  const requested = values.target?.length ? values.target : TARGETS.map((target) => target.slug);
  const selected = [];
  for (const slug of [...new Set(requested)]) {
    const target = TARGETS.find((candidate) => candidate.slug === slug);
    if (!target) throw new Error(`unknown release target: ${slug}`);
    selected.push(target);
  }
  return selected;
}

function automaticSmokeTarget(targets) {
  const platformName = platform();
  const architecture = arch();
  const slug = platformName === "linux"
    ? architecture === "arm64" ? "linux-arm64" : "linux-x64"
    : platformName === "darwin"
      ? architecture === "arm64" ? "darwin-arm64" : "darwin-x64"
      : platformName === "win32"
        ? architecture === "arm64" ? "windows-arm64" : "windows-x64"
        : null;
  return targets.some((target) => target.slug === slug) ? slug : null;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileRecord(path) {
  const metadata = await stat(path);
  return { name: basename(path), size: metadata.size, sha256: await sha256File(path) };
}

async function copyRuntimeAssets(destination) {
  for (const directory of SUPPORT_DIRECTORIES) {
    await cp(join(ROOT, directory), join(destination, directory), { recursive: true, force: true });
  }
  for (const file of SUPPORT_FILES) {
    await cp(join(ROOT, file), join(destination, file), { force: true });
  }
}

async function compileTarget(target, packageRoot) {
  const binDirectory = join(packageRoot, "bin");
  await mkdir(binDirectory, { recursive: true });
  for (const entry of ENTRIES) {
    const output = join(binDirectory, `${entry.name}${target.executableSuffix}`);
    run(process.execPath, [
      "build",
      "--compile",
      `--target=${target.bunTarget}`,
      "--minify",
      join(ROOT, entry.source),
      "--outfile",
      output
    ]);
    if (!target.executableSuffix) await chmod(output, 0o755);
    const metadata = await stat(output);
    if (!metadata.isFile() || metadata.size < 1_000_000) {
      throw new Error(`compiled executable is unexpectedly small: ${output}`);
    }
  }
}

async function writeBuildInfo(packageRoot, target, version) {
  const buildInfo = {
    $schema: "historia.release.build-info/v1",
    version,
    target: target.slug,
    bun_target: target.bunTarget,
    bun_version: Bun.version,
    source_commit: process.env.GITHUB_SHA ?? null,
    executables: ENTRIES.map((entry) => `${entry.name}${target.executableSuffix}`),
    extension: {
      bundled_in_installer: true,
      bundle_sha256: COLLECT_EXTENSION_BUNDLE_SHA256,
      chromium_id: CHROMIUM_EXTENSION_ID,
      firefox_id: FIREFOX_EXTENSION_ID
    }
  };
  await writeFile(join(packageRoot, "BUILD-INFO.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
}

async function smokePackage(packageRoot, target) {
  const bin = join(packageRoot, "bin");
  const suffix = target.executableSuffix;
  const versionCommands = ["gw-historian", "historia", "historia-collect"];
  for (const name of versionCommands) {
    const output = run(join(bin, `${name}${suffix}`), ["--version"], { cwd: packageRoot, quiet: true });
    if (output !== PACKAGE.version) throw new Error(`${name} reported unexpected version: ${output}`);
  }

  const temporaryConfig = join(packageRoot, ".smoke-config");
  const output = run(join(bin, `historia-collect${suffix}`), ["paths", "--config-root", temporaryConfig], {
    cwd: packageRoot,
    quiet: true
  });
  const paths = JSON.parse(output);
  if (!paths.ok || paths.chromiumExtensionId !== CHROMIUM_EXTENSION_ID) {
    throw new Error("compiled historia-collect failed embedded extension smoke test");
  }
  const manifest = JSON.parse(await readFile(join(paths.extensionDirectory, "manifest.json"), "utf8"));
  if (manifest.version !== PACKAGE.version || paths.extensionBundle?.bundle_sha256 !== COLLECT_EXTENSION_BUNDLE_SHA256) {
    throw new Error("materialized extension metadata does not match the compiled release");
  }
  await rm(temporaryConfig, { recursive: true, force: true });
}

function archivePath(output, version, target) {
  const extension = target.archive === "zip" ? "zip" : "tar.gz";
  return join(output, `historia-v${version}-${target.slug}.${extension}`);
}

async function archivePackage(stage, packageRoot, output, version, target) {
  const asset = archivePath(output, version, target);
  const rootName = basename(packageRoot);
  if (target.archive === "zip") {
    run("zip", ["-q", "-r", asset, rootName], { cwd: stage });
    const listing = run("unzip", ["-Z1", asset], { quiet: true });
    if (!listing.includes(`${rootName}/bin/historia${target.executableSuffix}`)) {
      throw new Error(`Windows archive is missing historia executable: ${asset}`);
    }
  } else {
    run("tar", ["-czf", asset, "-C", stage, rootName]);
    const listing = run("tar", ["-tzf", asset], { quiet: true });
    if (!listing.includes(`${rootName}/bin/historia`)) {
      throw new Error(`Unix archive is missing historia executable: ${asset}`);
    }
  }
  return asset;
}

async function buildExtensionArchive(stage, output, version) {
  const rootName = `historia-collect-extension-v${version}`;
  const directory = join(stage, rootName);
  await cp(join(ROOT, "extension"), directory, { recursive: true, force: true });
  const asset = join(output, `${rootName}.zip`);
  run("zip", ["-q", "-r", asset, rootName], { cwd: stage });
  const listing = run("unzip", ["-Z1", asset], { quiet: true });
  if (!listing.includes(`${rootName}/manifest.json`) || !listing.includes(`${rootName}/src/background.js`)) {
    throw new Error("extension archive is incomplete");
  }
  return asset;
}

async function writeReleaseMetadata(output, version, targets, assets) {
  const records = [];
  for (const asset of assets) records.push(await fileRecord(asset));
  records.sort((left, right) => left.name.localeCompare(right.name));

  const manifestPath = join(output, "release-manifest-v1.json");
  const manifest = {
    $schema: "historia.release.manifest/v1",
    version,
    source_commit: process.env.GITHUB_SHA ?? null,
    bun_version: Bun.version,
    targets: targets.map(({ slug, bunTarget, archive }) => ({ slug, bun_target: bunTarget, archive })),
    extension: {
      bundle_sha256: COLLECT_EXTENSION_BUNDLE_SHA256,
      chromium_id: CHROMIUM_EXTENSION_ID,
      firefox_id: FIREFOX_EXTENSION_ID
    },
    assets: records
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestRecord = await fileRecord(manifestPath);
  const checksums = [...records, manifestRecord]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((record) => `${record.sha256}  ${record.name}`)
    .join("\n");
  await writeFile(join(output, "SHA256SUMS"), `${checksums}\n`);
  return { manifestPath, records };
}

async function main() {
  const { values } = parseArgs({
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "string" },
      output: { type: "string" },
      target: { type: "string", multiple: true },
      "smoke-target": { type: "string" },
      "no-smoke": { type: "boolean" },
      "keep-stage": { type: "boolean" }
    }
  });
  if (values.help) {
    usage();
    return;
  }

  const version = String(values.version ?? PACKAGE.version).replace(/^v/, "");
  if (!VERSION_PATTERN.test(version)) throw new Error(`invalid release version: ${version}`);
  if (version !== PACKAGE.version) {
    throw new Error(`release version ${version} does not match package.json ${PACKAGE.version}`);
  }

  const output = resolve(values.output ?? DEFAULT_OUTPUT);
  const stage = join(output, ".stage");
  const targets = selectedTargets(values);
  const smokeTarget = values["no-smoke"]
    ? null
    : values["smoke-target"] ?? automaticSmokeTarget(targets);
  if (smokeTarget && !targets.some((target) => target.slug === smokeTarget)) {
    throw new Error(`smoke target is not selected: ${smokeTarget}`);
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const assets = [];
  try {
    for (const target of targets) {
      const rootName = `historia-v${version}-${target.slug}`;
      const packageRoot = join(stage, rootName);
      await mkdir(packageRoot, { recursive: true });
      await copyRuntimeAssets(packageRoot);
      await compileTarget(target, packageRoot);
      await writeBuildInfo(packageRoot, target, version);
      if (target.slug === smokeTarget) await smokePackage(packageRoot, target);
      assets.push(await archivePackage(stage, packageRoot, output, version, target));
      await rm(packageRoot, { recursive: true, force: true });
    }

    assets.push(await buildExtensionArchive(stage, output, version));
    await writeReleaseMetadata(output, version, targets, assets);
  } finally {
    if (!values["keep-stage"]) await rm(stage, { recursive: true, force: true });
  }

  const files = (await readdir(output)).filter((name) => name !== ".stage").sort();
  console.log(JSON.stringify({
    ok: true,
    version,
    output,
    smoke_target: smokeTarget,
    targets: targets.map((target) => target.slug),
    files
  }, null, 2));
}

main().catch((error) => {
  console.error(`release build failed: ${error.message}`);
  process.exitCode = 1;
});
