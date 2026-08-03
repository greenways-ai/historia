import { createHash } from "node:crypto";

export const CHROMIUM_EXTENSION_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA40TTKEwVgyo4OMSE4VlQdYX/8/gMxA6pZuZyJd4hCzaINv3LaOHlcM9GxVeiMGm4IyZOdp6HhWP/cgU2KSgn2nl10e3ngw5vQ4xEnRoconN5/OgFgitYKpxGcoHTLmhji6X7PkXmTmq24eVG9BvoFurm4IzcEQPY+tjX7hc73AoYfHQ3p5lVv5HU7g+/v4dM9GgUmDL5rhpPUmZR6InbEmcPxleOnKTBAAiVHgb4Y7igGGgXTC5CC/iYc9JSScEWs1V6CZkmIkIYmUMr4LH8x/027139GQJSYNOoxhu7MBfoErVB4K1zLj/LopCEbxSEMRPoVXAcgz1G4vMyYbkpVQIDAQAB";
export const CHROMIUM_EXTENSION_ID = "idfjphfgkpmmgggnbomlalheckgdcefj";
export const FIREFOX_EXTENSION_ID = "historia-collect@greenways.ai";

export const SUPPORTED_BROWSERS = Object.freeze(["chrome", "chromium", "brave", "edge", "firefox"]);

const BROWSER_ALIASES = new Map([
  ["google-chrome", "chrome"],
  ["chrome", "chrome"],
  ["chromium-browser", "chromium"],
  ["chromium", "chromium"],
  ["brave-browser", "brave"],
  ["brave", "brave"],
  ["microsoft-edge", "edge"],
  ["edge", "edge"],
  ["firefox", "firefox"]
]);

export function normalizeBrowser(value = "chrome") {
  const requested = String(value ?? "chrome").trim().toLowerCase();
  const browser = BROWSER_ALIASES.get(requested);
  if (!browser) throw new Error(`unsupported browser: ${requested || "empty"}`);
  return browser;
}

export function isChromiumBrowser(value) {
  return normalizeBrowser(value) !== "firefox";
}

export function chromeExtensionIdFromKey(key = CHROMIUM_EXTENSION_KEY) {
  const publicKey = Buffer.from(String(key), "base64");
  if (!publicKey.length) throw new Error("Chromium extension key is empty or invalid");
  const prefix = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...prefix].map((byte) => {
    const high = String.fromCharCode(97 + (byte >> 4));
    const low = String.fromCharCode(97 + (byte & 0x0f));
    return `${high}${low}`;
  }).join("");
}

export function extensionIdentityFor(browser, override = null) {
  const kind = normalizeBrowser(browser);
  const identity = String(override ?? (kind === "firefox" ? FIREFOX_EXTENSION_ID : CHROMIUM_EXTENSION_ID)).trim();
  if (!identity || /[\0\r\n]/.test(identity)) throw new Error("extension identity is required");
  if (kind !== "firefox" && !/^[a-p]{32}$/.test(identity)) {
    throw new Error("Chromium extension ID must be 32 lowercase letters from a to p");
  }
  return identity;
}

if (chromeExtensionIdFromKey() !== CHROMIUM_EXTENSION_ID) {
  throw new Error("Historia Collect Chromium extension key and ID do not match");
}
