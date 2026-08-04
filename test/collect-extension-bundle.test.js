import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLECT_EXTENSION_BUNDLE_SHA256,
  collectExtensionBundleManifest,
  inspectCollectExtensionBundle,
  materializeCollectExtension
} from "../src/collect/extension-bundle.js";
import { CHROMIUM_EXTENSION_ID, chromeExtensionIdFromKey } from "../src/collect/extension-identity.js";

describe("embedded Historia Collect extension", () => {
  test("materializes a checksum-verified, idempotent unpacked extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-extension-bundle-"));
    try {
      const directory = join(root, "extension");
      const first = await materializeCollectExtension(directory);
      expect(first).toMatchObject({ ok: true, idempotent: false, directory });
      expect(first.bundle_sha256).toBe(COLLECT_EXTENSION_BUNDLE_SHA256);
      expect(first.files).toBe(8);

      const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
      expect(chromeExtensionIdFromKey(manifest.key)).toBe(CHROMIUM_EXTENSION_ID);
      const privacy = await readFile(join(directory, "src/privacy.html"), "utf8");
      expect(privacy).toContain("Historia Collect privacy");
      expect(privacy).toContain("local Git-native Historia vault");
      expect(await inspectCollectExtensionBundle(directory)).toMatchObject({ ok: true, directory });

      const second = await materializeCollectExtension(directory);
      expect(second).toMatchObject({ ok: true, idempotent: true, directory });
      expect(collectExtensionBundleManifest().files).toHaveLength(first.files);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replaces a corrupted materialized extension from the embedded payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-extension-repair-"));
    try {
      const directory = join(root, "extension");
      await materializeCollectExtension(directory);
      await writeFile(join(directory, "src/content.js"), "corrupted\n");
      expect((await inspectCollectExtensionBundle(directory)).ok).toBe(false);

      const repaired = await materializeCollectExtension(directory);
      expect(repaired.idempotent).toBe(false);
      expect((await inspectCollectExtensionBundle(directory)).ok).toBe(true);
      expect(await readFile(join(directory, "src/content.js"), "utf8")).not.toBe("corrupted\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
