import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLECT_EXTENSION_BUNDLE_SHA256,
  collectExtensionBundleManifest,
  inspectCollectExtensionBundle,
  materializeCollectExtension,
} from "../../src/collect/extension-bundle.js";
import { CHROMIUM_EXTENSION_ID, chromeExtensionIdFromKey } from "../../src/collect/extension-identity.js";

async function checkMaterialization() {
  const root = await mkdtemp(join(tmpdir(), "historia-extension-bundle-"));
  try {
    const directory = join(root, "extension");
    const first = await materializeCollectExtension(directory);
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    assert.equal(first.directory, directory);
    assert.equal(first.bundle_sha256, COLLECT_EXTENSION_BUNDLE_SHA256);
    assert.equal(first.files, 14);

    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    assert.equal(chromeExtensionIdFromKey(manifest.key), CHROMIUM_EXTENSION_ID);
    assert.equal(manifest.name, "Historia for ChatGPT");
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.host_permissions, undefined);
    const privacy = await readFile(join(directory, "src/privacy.html"), "utf8");
    assert.ok(privacy.includes("Historia for ChatGPT privacy"));
    assert.ok(privacy.includes("does not scrape ChatGPT conversations"));
    assert.ok((await readFile(join(directory, "src/native-provider.js"), "utf8")).includes("historia:history-search"));
    assert.equal((await inspectCollectExtensionBundle(directory)).ok, true);

    const second = await materializeCollectExtension(directory);
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.directory, directory);
    assert.equal(collectExtensionBundleManifest().files.length, first.files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function checkRepair() {
  const root = await mkdtemp(join(tmpdir(), "historia-extension-repair-"));
  try {
    const directory = join(root, "extension");
    await materializeCollectExtension(directory);
    await writeFile(join(directory, "src/companion-state.js"), "corrupted\n");
    assert.equal((await inspectCollectExtensionBundle(directory)).ok, false);

    const repaired = await materializeCollectExtension(directory);
    assert.equal(repaired.idempotent, false);
    assert.equal((await inspectCollectExtensionBundle(directory)).ok, true);
    assert.notEqual(await readFile(join(directory, "src/companion-state.js"), "utf8"), "corrupted\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await checkMaterialization();
await checkRepair();
console.log(JSON.stringify({ ok: true, cases: 2 }));
