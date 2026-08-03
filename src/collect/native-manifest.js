import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const DEFAULT_NATIVE_HOST_NAME = "ai.greenways.historia_collect";

function hostName(value) {
  const name = String(value ?? DEFAULT_NATIVE_HOST_NAME);
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(name)) throw new Error(`invalid native host name: ${name}`);
  return name;
}

function browserKind(value) {
  const browser = String(value ?? "chrome").toLowerCase();
  if (!new Set(["chrome", "chromium", "firefox"]).has(browser)) throw new Error(`unsupported browser: ${browser}`);
  return browser;
}

function extensionIdentity(value, browser) {
  const identity = String(value ?? "").trim();
  if (!identity || /[\0\r\n]/.test(identity)) throw new Error("extension identity is required");
  if (browser === "firefox") return identity;
  if (!/^[a-p]{32}$/.test(identity)) throw new Error("Chrome extension ID must be 32 lowercase letters from a to p");
  return `chrome-extension://${identity}/`;
}

export function createNativeHostManifest({
  browser = "chrome",
  extensionId,
  hostPath,
  name = DEFAULT_NATIVE_HOST_NAME,
  description = "Historia Collect native messaging host"
} = {}) {
  const kind = browserKind(browser);
  if (!hostPath) throw new Error("hostPath is required");
  if (!isAbsolute(hostPath)) throw new Error("native host path must be absolute");
  const absolutePath = resolve(hostPath);
  const manifest = {
    name: hostName(name),
    description: String(description),
    path: absolutePath,
    type: "stdio"
  };
  const identity = extensionIdentity(extensionId, kind);
  if (kind === "firefox") manifest.allowed_extensions = [identity];
  else manifest.allowed_origins = [identity];
  return manifest;
}

export async function writeNativeHostManifest(outputPath, options = {}) {
  if (!outputPath) throw new Error("outputPath is required");
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  const manifest = createNativeHostManifest(options);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, output: path, manifest };
}
