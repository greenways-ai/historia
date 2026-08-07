import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

function runIsolatedBundleChecks() {
  return new Promise((resolve, reject) => {
    // Bun 1.2.18 shares module identities across test files. The extension
    // sources are executed as JavaScript elsewhere and embedded as text here,
    // so this integration check needs its own module graph.
    const child = spawn(process.execPath, ["test/fixtures/collect-extension-bundle-check.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`isolated extension bundle checks failed (${code ?? "unknown"})\n${stderr || stdout}`));
    });
  });
}

describe("embedded Historia for ChatGPT extension", () => {
  test("materializes and repairs the bundle in an isolated module graph", async () => {
    expect(JSON.parse(await runIsolatedBundleChecks())).toEqual({ ok: true, cases: 2 });
  });
});
