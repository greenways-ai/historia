import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_STATE_PROTOCOL,
  createBookmark,
  createPrompt,
  normalizeCompanionState,
} from "../extension/src/companion-state.js";
import { createCompanionVaultStore } from "../src/chat/companion-vault.js";
import { GitVault } from "../src/vault/git-writer.js";

function companionState({ bookmarks = [], prompts = [], revision = 1 } = {}) {
  return normalizeCompanionState({
    protocol: COMPANION_STATE_PROTOCOL,
    revision,
    bookmarks,
    prompts,
  });
}

function clock(...values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

describe("Historia ChatGPT companion vault concurrency", () => {
  test("re-reads, merges, and retries when the Git ref changes during commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chatgpt-race-"));
    try {
      const vaultPath = join(root, "vault.git");
      const initialBookmark = createBookmark({
        url: "https://chatgpt.com/c/initial_123",
        title: "Initial history",
      }, {
        id: "bookmark/initial",
        now: () => new Date("2026-08-07T02:00:00.000Z"),
      });
      const concurrentPrompt = createPrompt({
        title: "Concurrent prompt",
        text: "Keep the concurrent prompt.",
      }, {
        id: "prompt/concurrent",
        now: () => new Date("2026-08-07T02:01:00.000Z"),
      });
      const incomingBookmark = createBookmark({
        url: "https://chatgpt.com/c/incoming_456",
        title: "Incoming history",
      }, {
        id: "bookmark/incoming",
        now: () => new Date("2026-08-07T02:02:00.000Z"),
      });

      const baseStore = createCompanionVaultStore({
        vaultPath,
        now: clock("2026-08-07T02:03:00.000Z"),
      });
      const base = await baseStore.push(companionState({ bookmarks: [initialBookmark] }), {
        expectedHead: null,
        source: "initial-device",
      });

      const competingStore = createCompanionVaultStore({
        vaultPath,
        now: clock("2026-08-07T02:04:00.000Z"),
      });
      let injected = false;
      const racingStore = createCompanionVaultStore({
        vaultPath,
        now: clock("2026-08-07T02:05:00.000Z", "2026-08-07T02:06:00.000Z"),
        maxCommitRetries: 2,
        vaultFactory: async (path) => {
          const vault = await GitVault.init(path);
          return new Proxy(vault, {
            get(target, property) {
              if (property === "commitFiles") {
                return async (options) => {
                  if (!injected) {
                    injected = true;
                    await competingStore.push(companionState({ prompts: [concurrentPrompt] }), {
                      expectedHead: options.expectedOldOid,
                      source: "concurrent-device",
                    });
                  }
                  return target.commitFiles(options);
                };
              }
              const value = target[property];
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      });

      const result = await racingStore.push(companionState({ bookmarks: [incomingBookmark] }), {
        expectedHead: base.head,
        source: "racing-device",
      });

      expect(result.conflict_merged).toBe(true);
      expect(result.commit_attempts).toBe(2);
      expect(result.previous_head).not.toBe(base.head);
      expect(result.state.bookmarks.map(({ id }) => id).sort()).toEqual([
        "bookmark/incoming",
        "bookmark/initial",
      ]);
      expect(result.state.prompts.map(({ id }) => id)).toEqual(["prompt/concurrent"]);

      const pulled = await racingStore.pull();
      expect(pulled.head).toBe(result.head);
      expect(pulled.state).toEqual(result.state);
      expect((await (await GitVault.init(vaultPath)).verify()).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
