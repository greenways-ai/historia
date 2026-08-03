import { describe, expect, test } from "bun:test";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  doctorCollect,
  installCollect,
  installNativeHost,
  nativeManifestLocation,
  uninstallCollect
} from "../src/collect/install.js";
import {
  CHROMIUM_EXTENSION_ID,
  CHROMIUM_EXTENSION_KEY,
  FIREFOX_EXTENSION_ID,
  chromeExtensionIdFromKey
} from "../src/collect/extension-identity.js";

const extensionPath = resolve("extension");

async function executable(path, content = "#!/bin/sh\nexit 0\n") {
  await writeFile(path, content, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

describe("Historia Collect installation", () => {
  test("pins the Chromium manifest key to the documented extension ID", async () => {
    const manifest = await Bun.file("extension/manifest.json").json();
    expect(manifest.key).toBe(CHROMIUM_EXTENSION_KEY);
    expect(chromeExtensionIdFromKey(manifest.key)).toBe(CHROMIUM_EXTENSION_ID);
    expect(CHROMIUM_EXTENSION_ID).toHaveLength(32);
  });

  test("installs, diagnoses, and removes Chromium and Firefox native manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-collect-install-"));
    try {
      const hostPath = await executable(join(root, "historia-collect-host"));
      const options = {
        browsers: ["chrome", "firefox"],
        hostPath,
        extensionPath,
        manifestRoot: join(root, "manifests"),
        configRoot: join(root, "config"),
        platformName: "linux",
        home: root,
        env: { ...process.env, XDG_CONFIG_HOME: join(root, "xdg") }
      };
      const installed = await installCollect(options);
      expect(installed.ok).toBe(true);
      expect(installed.extension.chromiumId).toBe(CHROMIUM_EXTENSION_ID);
      expect(installed.extension.firefoxId).toBe(FIREFOX_EXTENSION_ID);

      const chromeManifest = JSON.parse(await readFile(join(root, "manifests/chrome/ai.greenways.historia_collect.json"), "utf8"));
      expect(chromeManifest.path).toBe(hostPath);
      expect(chromeManifest.allowed_origins).toEqual([`chrome-extension://${CHROMIUM_EXTENSION_ID}/`]);

      const firefoxManifest = JSON.parse(await readFile(join(root, "manifests/firefox/ai.greenways.historia_collect.json"), "utf8"));
      expect(firefoxManifest.allowed_extensions).toEqual([FIREFOX_EXTENSION_ID]);

      const diagnosis = await doctorCollect(options);
      expect(diagnosis.ok).toBe(true);
      expect(diagnosis.installations.every((installation) => installation.ok)).toBe(true);

      expect((await uninstallCollect(options)).ok).toBe(true);
      await expect(access(join(root, "manifests/chrome/ai.greenways.historia_collect.json"))).rejects.toThrow();
      await expect(access(join(root, "manifests/firefox/ai.greenways.historia_collect.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("generates a launcher with absolute runtime and entry paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-collect-launcher-"));
    try {
      const entry = await executable(join(root, "native-entry.js"), "#!/usr/bin/env bun\n");
      const installed = await installNativeHost({
        browser: "brave",
        extensionPath,
        manifestRoot: join(root, "manifests"),
        configRoot: join(root, "config"),
        packageRoot: root,
        runtimePath: process.execPath,
        argvPath: null,
        nativeEntryPath: entry,
        platformName: "linux",
        home: root,
        env: { ...process.env, XDG_CONFIG_HOME: join(root, "xdg") }
      });
      expect(installed.ok).toBe(true);
      expect(installed.host.generated).toBe(true);
      const launcher = await readFile(installed.host.hostPath, "utf8");
      expect(launcher).toContain(resolve(process.execPath));
      expect(launcher).toContain(resolve(entry));
      expect(installed.status.checks.every((check) => check.ok)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("derives platform-specific user manifest locations", () => {
    expect(nativeManifestLocation("edge", {
      platformName: "darwin",
      home: "/Users/alex",
      configRoot: "/tmp/config"
    }).manifestPath).toBe("/Users/alex/Library/Application Support/Microsoft Edge/NativeMessagingHosts/ai.greenways.historia_collect.json");

    expect(nativeManifestLocation("firefox", {
      platformName: "linux",
      home: "/home/alex",
      env: {},
      configRoot: "/tmp/config"
    }).manifestPath).toBe("/home/alex/.mozilla/native-messaging-hosts/ai.greenways.historia_collect.json");

    expect(nativeManifestLocation("chrome", {
      platformName: "win32",
      home: "C:/Users/alex",
      configRoot: "C:/Users/alex/AppData/Local/Historia"
    }).registryKey).toBe("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.greenways.historia_collect");
  });
});
