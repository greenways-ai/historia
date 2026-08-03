import { describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(args, options = {}) {
  return Bun.spawnSync([process.execPath, "src/historia-cli.js", ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, HISTORIA_PACKAGE_ROOT: process.cwd(), ...options.env },
    stdout: "pipe",
    stderr: "pipe"
  });
}

describe("Historia CLI", () => {
  test("installs the chat retrieval skill for Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-codex-skill-"));
    try {
      const result = run(["agent", "install", "codex"], { env: { CODEX_HOME: root } });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.toString("utf8"));
      expect(output.agent).toBe("codex");
      await access(join(root, "skills/historia-chat-agent/SKILL.md"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("installs the chat retrieval skill at Kimi project scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-kimi-skill-"));
    try {
      const result = run(["agent", "install", "kimi", "--scope", "project"], { cwd: root });
      expect(result.exitCode).toBe(0);
      await access(join(root, ".kimi-code/skills/historia-chat-agent/SKILL.md"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
