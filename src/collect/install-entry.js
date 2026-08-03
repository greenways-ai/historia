#!/usr/bin/env bun

import { parseArgs } from "node:util";
import {
  SUPPORTED_BROWSERS,
  defaultCollectConfigRoot,
  doctorCollect,
  installCollect,
  uninstallCollect
} from "./install.js";
import {
  COLLECT_EXTENSION_BUNDLE_SHA256,
  defaultCollectExtensionDirectory,
  inspectCollectExtensionBundle,
  materializeCollectExtension
} from "./extension-bundle.js";
import { CHROMIUM_EXTENSION_ID, FIREFOX_EXTENSION_ID } from "./extension-identity.js";

const VERSION = "0.1.0";

function usage() {
  console.log(`Historia Collect ${VERSION}

Install and diagnose the local browser-to-Historia collection bridge.

Usage:
  historia-collect install [--browser <name>...] [--host-path <absolute-path>]
  historia-collect doctor [--browser <name>...]
  historia-collect uninstall [--browser <name>...]
  historia-collect paths
  historia-collect --version

Browsers:
  chrome, chromium, brave, edge, firefox

Options:
  --browser <name>       Browser to configure; repeat to configure more than one
  --extension-id <id>   Override the stable extension identity for one browser
  --host-path <path>     Explicit compiled native host path
  --extension-path <p>  Use an explicit unpacked extension directory
  --config-root <path>  Override Historia's local configuration directory
  --manifest-root <p>   Override browser manifest roots (testing/portable use)

Without --extension-path, the checksum-verified extension bundled into this
executable is materialized below Historia's local configuration directory.

Chromium extension ID: ${CHROMIUM_EXTENSION_ID}
Firefox extension ID:  ${FIREFOX_EXTENSION_ID}
Extension bundle SHA:  ${COLLECT_EXTENSION_BUNDLE_SHA256}
`);
}

function selectedBrowsers(values) {
  const requested = values.browser?.length ? values.browser : ["chrome"];
  if (values["extension-id"] && requested.length !== 1) {
    throw new Error("--extension-id can only be used when installing one browser");
  }
  return requested;
}

function baseOptions(values) {
  const configRoot = values["config-root"] ?? defaultCollectConfigRoot();
  return {
    browsers: selectedBrowsers(values),
    extensionId: values["extension-id"],
    hostPath: values["host-path"],
    extensionPath: values["extension-path"] ?? defaultCollectExtensionDirectory(configRoot),
    configRoot,
    manifestRoot: values["manifest-root"]
  };
}

async function installOptions(values) {
  const options = baseOptions(values);
  if (values["extension-path"]) return { options, extensionBundle: null };
  const extensionBundle = await materializeCollectExtension(options.extensionPath);
  return { options, extensionBundle };
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
    browser: { type: "string", multiple: true },
    "extension-id": { type: "string" },
    "host-path": { type: "string" },
    "extension-path": { type: "string" },
    "config-root": { type: "string" },
    "manifest-root": { type: "string" }
  }
});

async function main() {
  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help || positionals.length === 0) {
    usage();
    return;
  }

  const command = positionals[0];
  if (command === "install") {
    const prepared = await installOptions(values);
    const result = await installCollect(prepared.options);
    emit({ ...result, extensionBundle: prepared.extensionBundle });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "doctor") {
    const options = baseOptions(values);
    const result = await doctorCollect(options);
    const extensionBundle = values["extension-path"]
      ? null
      : await inspectCollectExtensionBundle(options.extensionPath);
    emit({ ...result, extensionBundle });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "uninstall") {
    emit(await uninstallCollect(baseOptions(values)));
    return;
  }
  if (command === "paths") {
    const prepared = await installOptions(values);
    emit({
      ok: true,
      extensionDirectory: prepared.options.extensionPath,
      extensionBundle: prepared.extensionBundle,
      chromiumExtensionId: CHROMIUM_EXTENSION_ID,
      firefoxExtensionId: FIREFOX_EXTENSION_ID,
      supportedBrowsers: SUPPORTED_BROWSERS
    });
    return;
  }

  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`historia-collect: ${error.message}\n`);
  process.exitCode = 1;
});
