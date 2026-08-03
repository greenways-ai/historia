import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  CHROMIUM_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  SUPPORTED_BROWSERS,
  extensionIdentityFor,
  normalizeBrowser
} from "./extension-identity.js";
import { createNativeHostManifest, DEFAULT_NATIVE_HOST_NAME } from "./native-manifest.js";

const MAC_MANIFEST_DIRECTORIES = {
  chrome: ["Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"],
  chromium: ["Library", "Application Support", "Chromium", "NativeMessagingHosts"],
  brave: ["Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"],
  edge: ["Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"],
  firefox: ["Library", "Application Support", "Mozilla", "NativeMessagingHosts"]
};

const LINUX_MANIFEST_DIRECTORIES = {
  chrome: ["google-chrome", "NativeMessagingHosts"],
  chromium: ["chromium", "NativeMessagingHosts"],
  brave: ["BraveSoftware", "Brave-Browser", "NativeMessagingHosts"],
  edge: ["microsoft-edge", "NativeMessagingHosts"]
};

const WINDOWS_REGISTRY_ROOTS = {
  chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
  chromium: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
  brave: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
  edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
  firefox: "HKCU\\Software\\Mozilla\\NativeMessagingHosts"
};

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => resolve(String(value))))];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function executableFilename(platformName = platform()) {
  return platformName === "win32" ? "historia-collect-host.exe" : "historia-collect-host";
}

async function command(commandName, args, { allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(commandName, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`${commandName} ${args.join(" ")} failed: ${result.stderr || result.stdout}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

async function fileCheck(path, { executable = false, platformName = platform() } = {}) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return { ok: false, reason: "not-a-file" };
    if (executable && platformName !== "win32") {
      try { await access(path, fsConstants.X_OK); }
      catch { return { ok: false, reason: "not-executable" }; }
    }
    if (executable && platformName === "win32" && extname(path).toLowerCase() !== ".exe") {
      return { ok: false, reason: "not-a-windows-executable" };
    }
    return { ok: true, size: metadata.size };
  } catch (error) {
    return { ok: false, reason: error.code === "ENOENT" ? "missing" : error.message };
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rm(path, { force: true });
  await rename(temporary, path);
  if (platform() !== "win32") await chmod(path, 0o600);
}

export function defaultCollectConfigRoot({
  platformName = platform(),
  home = homedir(),
  env = process.env
} = {}) {
  if (platformName === "darwin") return join(home, "Library", "Application Support", "Historia");
  if (platformName === "win32") return resolve(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Historia");
  return resolve(env.XDG_CONFIG_HOME ?? join(home, ".config"), "historia");
}

export function nativeManifestLocation(browser, {
  platformName = platform(),
  home = homedir(),
  env = process.env,
  configRoot = defaultCollectConfigRoot({ platformName, home, env }),
  manifestRoot = null,
  name = DEFAULT_NATIVE_HOST_NAME
} = {}) {
  const kind = normalizeBrowser(browser);
  const filename = `${name}.json`;
  if (manifestRoot) {
    return { browser: kind, manifestPath: join(resolve(manifestRoot), kind, filename), registryKey: null };
  }
  if (platformName === "darwin") {
    return { browser: kind, manifestPath: join(home, ...MAC_MANIFEST_DIRECTORIES[kind], filename), registryKey: null };
  }
  if (platformName === "win32") {
    return {
      browser: kind,
      manifestPath: join(configRoot, "native-messaging", kind, filename),
      registryKey: `${WINDOWS_REGISTRY_ROOTS[kind]}\\${name}`
    };
  }
  if (kind === "firefox") {
    return { browser: kind, manifestPath: join(home, ".mozilla", "native-messaging-hosts", filename), registryKey: null };
  }
  const xdg = resolve(env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return { browser: kind, manifestPath: join(xdg, ...LINUX_MANIFEST_DIRECTORIES[kind], filename), registryKey: null };
}

export function browserExtensionPage(browser) {
  const kind = normalizeBrowser(browser);
  if (kind === "firefox") return "about:debugging#/runtime/this-firefox";
  if (kind === "edge") return "edge://extensions";
  if (kind === "brave") return "brave://extensions";
  return "chrome://extensions";
}

export async function resolveExtensionDirectory({ extensionPath = null, packageRoot = null } = {}) {
  const root = resolve(packageRoot ?? process.env.HISTORIA_PACKAGE_ROOT ?? resolve(import.meta.dir, "../.."));
  const directory = resolve(extensionPath ?? join(root, "extension"));
  const manifestPath = join(directory, "manifest.json");
  const check = await fileCheck(manifestPath);
  if (!check.ok) throw new Error(`Historia Collect extension manifest is unavailable: ${manifestPath}`);
  return directory;
}

async function createLauncher({ configRoot, runtimePath, nativeEntryPath, platformName }) {
  if (platformName === "win32") {
    throw new Error("Windows installation requires a compiled historia-collect-host.exe or an explicit --host-path");
  }
  const runtime = resolve(runtimePath);
  const entry = resolve(nativeEntryPath);
  const [runtimeCheck, entryCheck] = await Promise.all([fileCheck(runtime, { executable: true, platformName }), fileCheck(entry)]);
  if (!runtimeCheck.ok) throw new Error(`Bun runtime is unavailable or not executable: ${runtime}`);
  if (!entryCheck.ok) throw new Error(`Historia native host entry is unavailable: ${entry}`);
  const launcher = join(configRoot, "bin", "historia-collect-host");
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(launcher, `#!/bin/sh\nexec ${shellQuote(runtime)} ${shellQuote(entry)} "$@"\n`, { mode: 0o700 });
  await chmod(launcher, 0o700);
  return { hostPath: launcher, generated: true, runtimePath: runtime, nativeEntryPath: entry };
}

export async function resolveNativeHost({
  hostPath = null,
  packageRoot = null,
  configRoot = defaultCollectConfigRoot(),
  runtimePath = process.execPath,
  argvPath = process.argv[1],
  nativeEntryPath = null,
  platformName = platform(),
  env = process.env
} = {}) {
  const root = resolve(packageRoot ?? env.HISTORIA_PACKAGE_ROOT ?? resolve(import.meta.dir, "../.."));
  const requested = hostPath ?? env.HISTORIA_COLLECT_HOST;
  if (requested) {
    if (!isAbsolute(requested)) throw new Error("native host path must be absolute");
    const absolute = resolve(requested);
    const check = await fileCheck(absolute, { executable: true, platformName });
    if (!check.ok) throw new Error(`native host is unavailable: ${absolute} (${check.reason})`);
    return { hostPath: absolute, generated: false };
  }

  const filename = executableFilename(platformName);
  const candidates = unique([
    join(dirname(resolve(runtimePath)), filename),
    argvPath ? join(dirname(resolve(argvPath)), filename) : null,
    join(root, "dist", filename)
  ]);
  for (const candidate of candidates) {
    const check = await fileCheck(candidate, { executable: true, platformName });
    if (check.ok) return { hostPath: candidate, generated: false };
  }

  const runtimeName = basename(runtimePath).toLowerCase();
  if (/^bun(?:\.exe)?$/.test(runtimeName)) {
    return createLauncher({
      configRoot: resolve(configRoot),
      runtimePath,
      nativeEntryPath: nativeEntryPath ?? join(root, "src", "collect", "native-entry.js"),
      platformName
    });
  }

  throw new Error(
    `historia-collect-host was not found beside ${runtimePath}; build the host binary or pass --host-path`
  );
}

async function registerWindowsManifest(registryKey, manifestPath, runner = command) {
  await runner("reg.exe", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]);
}

async function unregisterWindowsManifest(registryKey, runner = command) {
  return runner("reg.exe", ["delete", registryKey, "/f"], { allowFailure: true });
}

export async function installNativeHost({
  browser = "chrome",
  extensionId = null,
  hostPath = null,
  extensionPath = null,
  packageRoot = null,
  platformName = platform(),
  home = homedir(),
  env = process.env,
  configRoot = null,
  manifestRoot = null,
  runtimePath = process.execPath,
  argvPath = process.argv[1],
  nativeEntryPath = null,
  name = DEFAULT_NATIVE_HOST_NAME,
  commandRunner = command
} = {}) {
  const kind = normalizeBrowser(browser);
  const resolvedConfigRoot = resolve(configRoot ?? defaultCollectConfigRoot({ platformName, home, env }));
  const [host, extensionDirectory] = await Promise.all([
    resolveNativeHost({
      hostPath,
      packageRoot,
      configRoot: resolvedConfigRoot,
      runtimePath,
      argvPath,
      nativeEntryPath,
      platformName,
      env
    }),
    resolveExtensionDirectory({ extensionPath, packageRoot })
  ]);
  const identity = extensionIdentityFor(kind, extensionId);
  const location = nativeManifestLocation(kind, {
    platformName,
    home,
    env,
    configRoot: resolvedConfigRoot,
    manifestRoot,
    name
  });
  const manifest = createNativeHostManifest({ browser: kind, extensionId: identity, hostPath: host.hostPath, name });
  await writeJsonAtomic(location.manifestPath, manifest);
  if (location.registryKey) await registerWindowsManifest(location.registryKey, location.manifestPath, commandRunner);
  const status = await inspectNativeHost({
    browser: kind,
    extensionId: identity,
    platformName,
    home,
    env,
    configRoot: resolvedConfigRoot,
    manifestRoot,
    name,
    commandRunner
  });
  return {
    ok: status.ok,
    browser: kind,
    platform: platformName,
    extensionId: identity,
    extensionDirectory,
    extensionPage: browserExtensionPage(kind),
    host,
    manifestPath: location.manifestPath,
    registryKey: location.registryKey,
    status
  };
}

export async function inspectNativeHost({
  browser = "chrome",
  extensionId = null,
  platformName = platform(),
  home = homedir(),
  env = process.env,
  configRoot = null,
  manifestRoot = null,
  name = DEFAULT_NATIVE_HOST_NAME,
  commandRunner = command
} = {}) {
  const kind = normalizeBrowser(browser);
  const identity = extensionIdentityFor(kind, extensionId);
  const resolvedConfigRoot = resolve(configRoot ?? defaultCollectConfigRoot({ platformName, home, env }));
  const location = nativeManifestLocation(kind, {
    platformName,
    home,
    env,
    configRoot: resolvedConfigRoot,
    manifestRoot,
    name
  });
  const checks = [];
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(location.manifestPath, "utf8"));
    checks.push({ name: "manifest", ok: true, path: location.manifestPath });
  } catch (error) {
    checks.push({ name: "manifest", ok: false, path: location.manifestPath, error: error.code ?? error.message });
  }
  if (manifest) {
    const host = await fileCheck(manifest.path, { executable: true, platformName });
    checks.push({ name: "host", path: manifest.path, ...host });
    checks.push({ name: "name", ok: manifest.name === name, expected: name, actual: manifest.name ?? null });
    const allowed = kind === "firefox"
      ? manifest.allowed_extensions
      : manifest.allowed_origins;
    const expected = kind === "firefox" ? identity : `chrome-extension://${identity}/`;
    checks.push({ name: "extension-identity", ok: Array.isArray(allowed) && allowed.length === 1 && allowed[0] === expected, expected, actual: allowed ?? null });
  }
  if (location.registryKey) {
    const result = await commandRunner("reg.exe", ["query", location.registryKey, "/ve"], { allowFailure: true });
    checks.push({ name: "registry", ok: result.code === 0, key: location.registryKey, error: result.code === 0 ? null : result.stderr || result.stdout });
  }
  return {
    ok: checks.every((check) => check.ok),
    browser: kind,
    extensionId: identity,
    manifestPath: location.manifestPath,
    registryKey: location.registryKey,
    manifest,
    checks
  };
}

export async function uninstallNativeHost({
  browser = "chrome",
  platformName = platform(),
  home = homedir(),
  env = process.env,
  configRoot = null,
  manifestRoot = null,
  name = DEFAULT_NATIVE_HOST_NAME,
  commandRunner = command
} = {}) {
  const kind = normalizeBrowser(browser);
  const resolvedConfigRoot = resolve(configRoot ?? defaultCollectConfigRoot({ platformName, home, env }));
  const location = nativeManifestLocation(kind, {
    platformName,
    home,
    env,
    configRoot: resolvedConfigRoot,
    manifestRoot,
    name
  });
  if (location.registryKey) await unregisterWindowsManifest(location.registryKey, commandRunner);
  await rm(location.manifestPath, { force: true });
  return { ok: true, browser: kind, manifestPath: location.manifestPath, registryKey: location.registryKey };
}

function browserList(browsers) {
  const requested = Array.isArray(browsers) ? browsers : browsers ? [browsers] : ["chrome"];
  return [...new Set(requested.map(normalizeBrowser))];
}

export async function installCollect({ browsers = ["chrome"], ...options } = {}) {
  const installations = [];
  for (const browser of browserList(browsers)) installations.push(await installNativeHost({ ...options, browser }));
  const extensionDirectory = installations[0]?.extensionDirectory ?? await resolveExtensionDirectory(options);
  return {
    ok: installations.every((installation) => installation.ok),
    extension: {
      directory: extensionDirectory,
      chromiumId: CHROMIUM_EXTENSION_ID,
      firefoxId: FIREFOX_EXTENSION_ID
    },
    installations
  };
}

export async function doctorCollect({ browsers = ["chrome"], ...options } = {}) {
  const installations = [];
  for (const browser of browserList(browsers)) installations.push(await inspectNativeHost({ ...options, browser }));
  let extension;
  try {
    extension = { ok: true, directory: await resolveExtensionDirectory(options) };
  } catch (error) {
    extension = { ok: false, error: error.message };
  }
  return { ok: extension.ok && installations.every((installation) => installation.ok), extension, installations };
}

export async function uninstallCollect({ browsers = ["chrome"], ...options } = {}) {
  const installations = [];
  for (const browser of browserList(browsers)) installations.push(await uninstallNativeHost({ ...options, browser }));
  return { ok: true, installations };
}

export { SUPPORTED_BROWSERS };
