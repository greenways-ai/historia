import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID, chromeExtensionIdFromKey } from "../src/collect/extension-identity.js";

const manifest = await Bun.file("extension/manifest.json").json();
const popup = await readFile("extension/src/popup.html", "utf8");
const options = await readFile("extension/src/options.html", "utf8");
const privacy = await readFile("extension/src/privacy.html", "utf8");
const background = await readFile("extension/src/background.js", "utf8");

describe("Historia for ChatGPT extension privacy policy", () => {
  test("preserves one cross-browser Manifest V3 background entry", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({
      scripts: ["src/background.js"],
      service_worker: "src/background.js",
      type: "module",
    });
    expect(chromeExtensionIdFromKey(manifest.key)).toBe(CHROMIUM_EXTENSION_ID);
    expect(manifest.browser_specific_settings.gecko.id).toBe(FIREFOX_EXTENSION_ID);
  });

  test("has no page extraction surface or ChatGPT host access", () => {
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect([...manifest.permissions].sort()).toEqual(["nativeMessaging", "storage", "tabs"]);
    for (const disallowed of [
      "activeTab", "webRequest", "webRequestBlocking", "cookies", "history", "downloads",
      "proxy", "management", "debugger", "geolocation", "unlimitedStorage", "scripting",
    ]) {
      expect(manifest.permissions).not.toContain(disallowed);
    }
    expect(background).not.toContain("tabs.sendMessage");
    expect(background).not.toContain("captureObservation");
  });

  test("uses Firefox consent only for explicit active-tab metadata", () => {
    const gecko = manifest.browser_specific_settings.gecko;
    expect(Number.parseInt(gecko.strict_min_version, 10)).toBeGreaterThanOrEqual(140);
    expect(gecko.data_collection_permissions).toEqual({ required: ["browsingActivity"] });
  });

  test("makes metadata-only storage, official export import, and sync opt-in visible", () => {
    for (const page of [popup, options, privacy]) {
      expect(page.toLowerCase()).toContain("chatgpt");
    }
    expect(popup).toContain("normalized ChatGPT URL and title");
    expect(popup).toContain("No page content is read");
    expect(options).toContain("Metadata only");
    expect(options).toContain("disabled by default");
    expect(options).toContain("official data export");
    expect(privacy).toContain("Browser metadata sync");
    expect(privacy).toContain("does not scrape ChatGPT conversations");
    expect(privacy).toContain("does not run a content script");
  });

  test("documents excluded credentials, local vault, browser sync, and manual prompt handoff", () => {
    for (const text of [
      "browser cookies",
      "ChatGPT access tokens",
      "undocumented ChatGPT APIs",
      "local Historia vault",
      "browser sync is disabled by default",
      "conversation bodies",
      "never inserts text",
      "Git history is intentionally durable",
    ]) {
      expect(privacy.toLowerCase()).toContain(text.toLowerCase());
    }
    const categories = manifest.browser_specific_settings.gecko.data_collection_permissions.required;
    expect(privacy).toContain("browsingActivity");
    expect(privacy).toContain("does not request");
    for (const excludedCategory of ["personalCommunications", "websiteContent"]) {
      expect(categories).not.toContain(excludedCategory);
      expect(privacy).toContain(excludedCategory);
    }
  });
});
