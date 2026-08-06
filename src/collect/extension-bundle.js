import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import extensionManifest from "../../extension/manifest.json" with { type: "text" };
import extensionBackground from "../../extension/src/background.js" with { type: "text" };
import extensionCompanionHtml from "../../extension/src/companion.html" with { type: "text" };
import extensionCompanionCss from "../../extension/src/companion.css" with { type: "text" };
import extensionCompanionJavaScript from "../../extension/src/companion.js" with { type: "text" };
import extensionNativeProvider from "../../extension/src/native-provider.js" with { type: "text" };
import extensionCompanionRoutes from "../../extension/src/companion-routes.js" with { type: "text" };
import extensionCompanionState from "../../extension/src/companion-state.js" with { type: "text" };
import extensionCompanionStorage from "../../extension/src/companion-storage.js" with { type: "text" };
import extensionOptionsHtml from "../../extension/src/options.html" with { type: "text" };
import extensionOptionsJavaScript from "../../extension/src/options.js" with { type: "text" };
import extensionPopupHtml from "../../extension/src/popup.html" with { type: "text" };
import extensionPopupJavaScript from "../../extension/src/popup.js" with { type: "text" };
import extensionPrivacyHtml from "../../extension/src/privacy.html" with { type: "text" };

const RECEIPT_NAME = ".historia-extension.json";
const BUNDLE_FILES = Object.freeze({
  "manifest.json": extensionManifest,
  "src/background.js": extensionBackground,
  "src/companion.html": extensionCompanionHtml,
  "src/companion.css": extensionCompanionCss,
  "src/companion.js": extensionCompanionJavaScript,
  "src/native-provider.js": extensionNativeProvider,
  "src/companion-routes.js": extensionCompanionRoutes,
  "src/companion-state.js": extensionCompanionState,
  "src/companion-storage.js": extensionCompanionStorage,
  "src/options.html": extensionOptionsHtml,
  "src/options.js": extensionOptionsJavaScript,
  "src/popup.html": extensionPopupHtml,
  "src/popup.js": extensionPopupJavaScript,
  "src/privacy.html": extensionPrivacyHtml,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedText(value) {
  const text = String(value);
  return text.endsWith("\n") ? text : `${text}\n`;
}

function fileRecords() {
  return Object.entries(BUNDLE_FILES)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => {
      const text = normalizedText(content);
      return { path, content: text, byte_count: Buffer.byteLength(text), sha256: sha256(text) };
    });
}

const FILE_RECORDS = Object.freeze(fileRecords());
export const COLLECT_EXTENSION_BUNDLE_SHA256 = sha256(
  FILE_RECORDS.map((file) => `${file.path}\0${file.byte_count}\0${file.sha256}\n`).join("")
);

async function fileMatches(path, expected) {
  try {
    const bytes = await readFile(path);
    return bytes.byteLength === expected.byte_count && sha256(bytes) === expected.sha256;
  } catch {
    return false;
  }
}

async function directoryExists(path) {
  try { return (await stat(path)).isDirectory(); }
  catch { return false; }
}

async function bundleIsCurrent(directory) {
  try {
    const receipt = JSON.parse(await readFile(join(directory, RECEIPT_NAME), "utf8"));
    if (receipt.bundle_sha256 !== COLLECT_EXTENSION_BUNDLE_SHA256) return false;
    if (!Array.isArray(receipt.files) || receipt.files.length !== FILE_RECORDS.length) return false;
    const checks = await Promise.all(FILE_RECORDS.map((file) => fileMatches(join(directory, file.path), file)));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

function receipt() {
  return {
    $schema: "historia.collect.extension-bundle/v1",
    bundle_sha256: COLLECT_EXTENSION_BUNDLE_SHA256,
    generated_at: null,
    files: FILE_RECORDS.map(({ path, byte_count, sha256: digest }) => ({ path, byte_count, sha256: digest })),
  };
}

async function writeBundle(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const file of FILE_RECORDS) {
    const destination = join(directory, file.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.content, { mode: 0o600 });
  }
  await writeFile(join(directory, RECEIPT_NAME), `${JSON.stringify(receipt(), null, 2)}\n`, { mode: 0o600 });
}

export function defaultCollectExtensionDirectory(configRoot) {
  if (!configRoot) throw new Error("configRoot is required for the embedded extension directory");
  return resolve(configRoot, "extension");
}

export function collectExtensionBundleManifest() {
  return receipt();
}

export async function inspectCollectExtensionBundle(directory) {
  const path = resolve(directory);
  const current = await bundleIsCurrent(path);
  return {
    ok: current,
    directory: path,
    bundle_sha256: COLLECT_EXTENSION_BUNDLE_SHA256,
    files: FILE_RECORDS.length,
  };
}

export async function materializeCollectExtension(directory, { force = false } = {}) {
  const destination = resolve(directory);
  if (!force && await bundleIsCurrent(destination)) {
    return {
      ok: true,
      idempotent: true,
      directory: destination,
      bundle_sha256: COLLECT_EXTENSION_BUNDLE_SHA256,
      files: FILE_RECORDS.length,
    };
  }

  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${destination}.old-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await writeBundle(temporary);

  const hadDestination = await directoryExists(destination);
  try {
    if (hadDestination) await rename(destination, backup);
    await rename(temporary, destination);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (hadDestination && await directoryExists(backup) && !await directoryExists(destination)) {
      await rename(backup, destination).catch(() => {});
    }
    throw error;
  }

  const verification = await inspectCollectExtensionBundle(destination);
  if (!verification.ok) throw new Error("materialized Historia companion extension failed checksum verification");
  return { ...verification, idempotent: false };
}
