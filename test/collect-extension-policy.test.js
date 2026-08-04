import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID, chromeExtensionIdFromKey } from "../src/collect/extension-identity.js";

const manifest = await Bun.file("extension/manifest.json").json();
const popup = await readFile("extension/src/popup.html", "utf8");
const options = await readFile("extension/src/options.html", "utf8");
const privacy = await readFile("extension/src/privacy.html", "utf8");

const CHATGPT_ORIGINS = [
  "https://chatgpt.com/*",
  "https://www.chatgpt.com/*",
  "https://chat.openai.com/*"
];

const FIREFOX_DATA_CATEGORIES = [
  "browsingActivity",
  "personalCommunications",
  "websiteContent"
];

describe("Historia Collect extension privacy policy", () => {
  test("preserves one cross-browser Manifest V3 background entry", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({
      scripts: ["src/background.js"],
      service_worker: "src/background.js",
      type: "module"
    });
    expect(chromeExtensionIdFromKey(manifest.key)).toBe(CHROMIUM_EXTENSION_ID);
    expect(manifest.browser_specific_settings.gecko.id).toBe(FIREFOX_EXTENSION_ID);
  });

  test("limits browser access to ChatGPT and local extension capabilities", () => {
    expect(manifest.host_permissions).toEqual(CHATGPT_ORIGINS);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(CHATGPT_ORIGINS);
    expect([...manifest.permissions].sort()).toEqual(["nativeMessaging", "storage", "tabs"]);
    for (const disallowed of ["webRequest", "webRequestBlocking", "cookies", "history", "downloads", "proxy", "management", "debugger", "geolocation", "unlimitedStorage"]) {
      expect(manifest.permissions).not.toContain(disallowed);
    }
  });

  test("uses Firefox built-in consent for the exact transmitted data categories", () => {
    const gecko = manifest.browser_specific_settings.gecko;
    expect(Number.parseInt(gecko.strict_min_version, 10)).toBeGreaterThanOrEqual(140);
    expect(gecko.data_collection_permissions).toEqual({ required: FIREFOX_DATA_CATEGORIES });
    expect(new Set(gecko.data_collection_permissions.required).size).toBe(FIREFOX_DATA_CATEGORIES.length);
  });

  test("makes local transmission and automatic collection visible before use", () => {
    for (const page of [popup, options]) {
      expect(page).toContain("local");
      expect(page).toContain("privacy.html");
    }
    expect(popup).toContain("Nothing is sent to Greenways or another remote service");
    expect(options).toContain("Automatic");
    expect(options).toContain("Disabled by default");
  });

  test("documents collected data, excluded credentials, retention, and local-only transfer", () => {
    for (const text of [
      "visible user and assistant message text",
      "current ChatGPT page origin, path, and title",
      "native messaging",
      "local Git-native Historia vault",
      "browser cookies",
      "access tokens",
      "analytics",
      "automatic collection is disabled",
      "purge"
    ]) {
      expect(privacy.toLowerCase()).toContain(text.toLowerCase());
    }
    expect(privacy).toContain("browsingActivity");
    expect(privacy).toContain("personalCommunications");
    expect(privacy).toContain("websiteContent");
  });
});
