#!/usr/bin/env bun

import { runNativeCollectHost } from "./native-host.js";

runNativeCollectHost().catch((error) => {
  process.stderr.write(`historia-collect-host: ${error.message}\n`);
  process.exitCode = 1;
});
