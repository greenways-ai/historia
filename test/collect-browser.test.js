import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { openChatIndex } from "../src/chat/index-storage.js";
import { indexHistoriaChats } from "../src/chat/indexer.js";
import { searchChatIndex } from "../src/chat/search.js";
import { archiveBrowserObservation } from "../src/collect/archive.js";
import { normalizeBrowserObservation, validateBrowserObservation } from "../src/collect/browser-observation.js";
import { createNativeCollectHandler, nativeCallerFromArgv } from "../src/collect/native-host.js";
import { createNativeHostManifest } from "../src/collect/native-manifest.js";
import { decodeNativeMessages, encodeNativeMessage } from "../src/collect/protocol.js";
import { GitVault } from "../src/vault/git-writer.js";

function observation(overrides = {}) {
  return {
    $schema: "historia.collect.browser-observation/0-alpha",
    provider: "openai",
    source_key: "browser-profile-1",
    observed_at: "2026-08-04T04:00:00Z",
    collector: { name: "historia-collect-extension", version: "0.1.0", mode: "manual" },
    conversation: {
      id: "browser-conversation-1",
      title: "Browser collected conversation",
      url: "https://chatgpt.com/c/browser-conversation-1?temporary=discarded#fragment",
      created_at: "2026-08-04T03:58:00Z",
      updated_at: null
    },
    messages: [
      {
        id: "browser-user-1",
        role: "user",
        author: { kind: "user", display_name: null },
        model: null,
        created_at: "2026-08-04T03:58:00Z",
        updated_at: null,
        blocks: [{ type: "text", text: "Archive this rendered chat locally." }],
        parents: [],
        attachments: [],
        state: { rendered: true }
      },
      {
        id: "browser-assistant-1",
        role: "assistant",
        author: { kind: "assistant", display_name: null },
        model: "gpt-test",
        created_at: "2026-08-04T03:59:00Z",
        updated_at: null,
        blocks: [{ type: "text", text: "The native host will commit it to the Historia vault." }],
        parents: ["browser-user-1"],
        attachments: [],
        state: { rendered: true }
      }
    ],
    active_path: ["browser-user-1", "browser-assistant-1"],
    ...overrides
  };
}

describe("Historia browser collection", () => {
  test("validates observations, strips URL secrets, and rejects credential metadata", () => {
    const normalized = normalizeBrowserObservation(observation());
    expect(normalized.observation.conversation.url).toBe("https://chatgpt.com/c/browser-conversation-1");
    expect(normalized.conversation.active_paths[0]).toHaveLength(2);
    expect(normalized.capture_sha256).toMatch(/^[a-f0-9]{64}$/);

    expect(() => validateBrowserObservation(observation({
      collector: { name: "bad", access_token: "must-not-enter-the-host" }
    }))).toThrow("credential field");
  });

  test("rejects custom refs outside the source-ref namespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-browser-ref-test-"));
    try {
      await expect(archiveBrowserObservation({
        observation: observation(),
        vaultPath: join(root, "vault.git"),
        ref: "refs/historia/private/browser"
      })).rejects.toThrow("source ref");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("archives rendered conversations idempotently and indexes their provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-browser-collect-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      const first = await archiveBrowserObservation({ observation: observation(), vaultPath });
      const second = await archiveBrowserObservation({
        observation: observation({ observed_at: "2026-08-04T04:05:00Z" }),
        vaultPath
      });
      expect(first.idempotent).toBe(false);
      expect(second.idempotent).toBe(true);
      expect(second.commitOid).toBe(first.commitOid);

      const indexed = await indexHistoriaChats({ vaultPath, databasePath });
      expect(indexed).toMatchObject({ commits: 1, imports: 1, new_revisions: 2 });
      const db = await openChatIndex(databasePath);
      try {
        const results = searchChatIndex(db, "native host", { limit: 10 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].provenance.source_ref).toBe(first.ref);
        expect(results[0].provenance.commit_oid).toBe(first.commitOid);
      } finally {
        db.close();
      }
      expect((await (await GitVault.init(vaultPath)).verify()).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("frames native messages and enforces the configured extension caller", async () => {
    const first = encodeNativeMessage({ protocol_version: "1.0", request_id: "one", op: "ping" });
    const second = encodeNativeMessage({ protocol_version: "1.0", request_id: "two", op: "status" });
    const joined = Buffer.concat([first, second]);
    const decoded = [];
    for await (const message of decodeNativeMessages(Readable.from([joined.subarray(0, 7), joined.subarray(7)]))) {
      decoded.push(message);
    }
    expect(decoded.map((message) => message.request_id)).toEqual(["one", "two"]);
    expect(nativeCallerFromArgv(["bun", "host", "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]))
      .toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop/");
    expect(nativeCallerFromArgv(["bun", "host", "/path/to/native-manifest.json", "historia-collect@greenways.ai"]))
      .toBe("historia-collect@greenways.ai");
    expect(() => createNativeHostManifest({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      hostPath: "relative/historia-collect-host"
    })).toThrow("must be absolute");
    expect(createNativeHostManifest({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      hostPath: "/usr/local/bin/historia-collect-host"
    }).allowed_origins).toEqual(["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]);

    const root = await mkdtemp(join(tmpdir(), "historia-native-host-test-"));
    try {
      const caller = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
      const handler = createNativeCollectHandler({
        vaultPath: join(root, "vault.git"),
        databasePath: join(root, "chat-index.sqlite"),
        caller,
        allowedCallers: [caller]
      });
      const response = await handler({ protocol_version: "1.0", request_id: "ping", op: "ping" });
      expect(response.ok).toBe(true);
      expect(response.result.capabilities).toContain("capture");
      const statusResponse = await handler({ protocol_version: "1.0", request_id: "status", op: "status" });
      expect(statusResponse.ok).toBe(true);
      expect(statusResponse.result.counts.conversations).toBe(0);
      expect(() => createNativeCollectHandler({
        vaultPath: join(root, "other.git"),
        databasePath: join(root, "other.sqlite"),
        caller: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
        allowedCallers: [caller]
      })).toThrow("not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
