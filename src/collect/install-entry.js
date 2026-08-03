#!/usr/bin/env bun

import { parseArgs } from "node:util";
import {
  SUPPORTED_BROWSERS,
  doctorCollect,
  installCollect,
  resolveExtensionDirectory,
  uninstallCollect
} from "./install.js";
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
  --extension-path <p>  Explicit unpacked extension directory
  --config-root <path>  Override Historia's local configuration directory
  --manifest-root <p>   Override browser manifest roots (testing/portable use)

Chromium extension ID: ${CHROMIUM_EXTENSION_ID}
Firefox extension ID:  ${FIREFOX_EXTENSION_ID}
`);
}

function selectedBrowsers(values) {
  const requested = values.browser?.length ? values.browser : ["chrome"];
  if (values["extension-id"] && requested.length !== 1) {
    throw new Error("--extension-id can only be used when installing one browser");
  }
  return requested;
}

function options(values) {
  return {
    browsers: selectedBrowsers(values),
    extensionId: values["extension-id"],
    hostPath: values["host-path"],
    extensionPath: values["extension-path"],
    configRoot: values["config-root"],
    manifestRoot: values["manifest-root"]
  };
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
    const result = await installCollect(options(values));
    emit(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "doctor") {
    const result = await doctorCollect(options(values));
    emit(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "uninstall") {
    emit(await uninstallCollect(options(values)));
    return;
  }
  if (command === "paths") {
    emit({
      ok: true,
      extensionDirectory: await resolveExtensionDirectory({ extensionPath: values["extension-path"] }),
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
