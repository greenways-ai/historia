import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_STATE_PROTOCOL,
  createBookmark,
  createPrompt,
  emptyCompanionState,
  normalizeCompanionState,
} from "../extension/src/companion-state.js";
import {
  CHATGPT_COMPANION_REF,
  companionStateDigest,
  createCompanionVaultStore,
} from "../src/chat/companion-vault.js";
import { createNativeCollectHandler } from "../src/collect/native-host.js";
import {
  createHistoriaNativeProvider,
  HISTORIA_NATIVE_PROVIDER_OPERATIONS,
} from "../src/collect/native-provider.js";
import { validateNativeRequest } from "../src/collect/protocol.js";
import { GitVault } from "../src/vault/git-writer.js";

const at = (value) => () => new Date(value);

function state({ bookmarks = [], prompts = [], revision = 1 } = {}) {
  return normalizeCompanionState({
    protocol: COMPANION_STATE_PROTOCOL,
    revision,
    bookmarks,
    prompts,
  });
}

describe("Historia ChatGPT native provider", () => {
  test("accepts the closed provider vocabulary and rejects arbitrary native operations", () => {
    for (const op of HISTORIA_NATIVE_PROVIDER_OPERATIONS) {
      expect(validateNativeRequest({
        protocol_version: "1.0",
        request_id: `request-${op.replaceAll("/", "-")}`,
        op,
        payload: {},
      }).op).toBe(op);
    }
    expect(() => validateNativeRequest({
      protocol_version: "1.0",
      request_id: "request-arbitrary",
      op: "filesystem/read",
      payload: {},
    })).toThrow("unsupported native operation");
    expect(() => validateNativeRequest({
      protocol_version: "1.0",
      request_id: "request-secret",
      op: "history/status",
      payload: {},
      token: "must-not-be-accepted",
    })).toThrow("unsupported field");
  });

  test("stores and conflict-merges companion metadata in a dedicated Git ref", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chatgpt-vault-"));
    try {
      const vaultPath = join(root, "vault.git");
      let clock = 0;
      const times = [
        "2026-08-07T00:00:00.000Z",
        "2026-08-07T00:01:00.000Z",
        "2026-08-07T00:02:00.000Z",
      ];
      const store = createCompanionVaultStore({
        vaultPath,
        now: () => new Date(times[Math.min(clock++, times.length - 1)]),
      });
      const bookmark = createBookmark({
        url: "https://chatgpt.com/c/example_123",
        title: "Native provider design",
      }, {
        id: "bookmark/native-provider",
        now: at("2026-08-07T00:00:00.000Z"),
      });
      const prompt = createPrompt({
        title: "Review native provider",
        text: "Review the provider boundary.",
      }, {
        id: "prompt/native-provider",
        now: at("2026-08-07T00:00:30.000Z"),
      });

      const first = await store.push(state({ bookmarks: [bookmark] }), { expectedHead: null, source: "test-device-a" });
      expect(first.idempotent).toBe(false);
      expect(first.ref).toBe(CHATGPT_COMPANION_REF);
      expect(first.state_sha256).toBe(companionStateDigest(first.state));
      expect(first.counts.visible_bookmarks).toBe(1);

      const second = await store.push(state({ prompts: [prompt] }), {
        expectedHead: null,
        source: "test-device-b",
      });
      expect(second.conflict_merged).toBe(true);
      expect(second.state.bookmarks).toHaveLength(1);
      expect(second.state.prompts).toHaveLength(1);
      expect(second.previous_head).toBe(first.head);

      const pulled = await store.pull();
      expect(pulled.head).toBe(second.head);
      expect(pulled.state_sha256).toBe(second.state_sha256);
      const idempotent = await store.push(pulled.state, { expectedHead: pulled.head });
      expect(idempotent.idempotent).toBe(true);
      expect(idempotent.head).toBe(pulled.head);

      const vault = await GitVault.init(vaultPath);
      expect((await vault.verify()).ok).toBe(true);
      expect(await vault.resolveRef(CHATGPT_COMPANION_REF)).toBe(second.head);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("provides bounded history, context, import, and sync operations", async () => {
    const calls = [];
    const companionState = emptyCompanionState();
    const companionStore = {
      status: async () => ({ protocol: "historia.chatgpt.vault-state/0-alpha", head: null, state_sha256: companionStateDigest(companionState), counts: {} }),
      pull: async () => ({ protocol: "historia.chatgpt.vault-state/0-alpha", head: null, state_sha256: companionStateDigest(companionState), state: companionState, counts: {} }),
      push: async (value, options) => ({ protocol: "historia.chatgpt.vault-state/0-alpha", head: "a".repeat(40), state_sha256: companionStateDigest(value), state: value, counts: {}, options }),
    };
    const fakeDb = { close() { calls.push(["close"]); } };
    const provider = createHistoriaNativeProvider({
      vaultPath: "/tmp/historia-provider-vault.git",
      databasePath: "/tmp/historia-provider-index.sqlite",
      now: at("2026-08-07T01:00:00.000Z"),
      dependencies: {
        companionStore,
        vaultFactory: async () => ({ repository: "/tmp/historia-provider-vault.git", verify: async () => ({ ok: true }) }),
        indexHistoriaChats: async () => ({ commits: 1, conversations: 1 }),
        openChatIndex: async () => fakeDb,
        chatIndexCounts: () => ({ sources: 1, conversations: 1, revisions: 2 }),
        chatIndexHeads: () => [{ source_ref: "refs/historia/sources/openai/test", head_commit_oid: "b".repeat(40) }],
        listChatConversations: () => [{ conversation_hid: "conversation/1", title: "Provider design" }],
        searchChatIndex: (_db, query) => [{
          rank: 1,
          score: -1,
          snippet: `[${query}] result`,
          content: "A long private source body that is returned only as a bounded preview.",
          conversation_hid: "conversation/1",
          message_hid: "message/1",
          revision_oid: "c".repeat(40),
          title: "Provider design",
          role: "assistant",
          model: "gpt-test",
          created_at: "2026-08-07T00:00:00.000Z",
          provenance: { source_ref: "refs/historia/sources/openai/test", commit_oid: "b".repeat(40) },
        }],
        loadConversationSnapshot: () => ({
          conversation_hid: "conversation/1",
          title: "Provider design",
          source_ref: "refs/historia/sources/openai/test",
          commit_oid: "b".repeat(40),
          messages: [{ message_hid: "message/1", revision_oid: "c".repeat(40), role: "assistant", content_text: "Bounded message", active: true }],
          edges: [],
        }),
        buildChatContext: (_db, query, options) => ({
          $schema: "historia.chat.context-bundle/0-alpha",
          query,
          budget: { requested_tokens: options.budget, estimated_tokens: 42 },
          matches: { included_messages: 1, conversation_snapshots: 1 },
          citations: [{ citation: "H1", commit_oid: "b".repeat(40) }],
          conversations: [],
        }),
        formatChatContextMarkdown: (bundle) => `# Context\n\n${bundle.query}\n`,
        archiveOpenAIExport: async (options) => {
          calls.push(["import", options]);
          return {
            ok: true,
            idempotent: false,
            ref: "refs/historia/sources/openai/test",
            commitOid: "d".repeat(40),
            previousCommitOid: null,
            receiptPath: "receipts/test.json",
            receipt: { archive: { sha256: "e".repeat(64) }, stats: { conversations: 1 }, warnings: [] },
          };
        },
      },
    });

    const status = await provider.handle("history/status");
    expect(status.counts.conversations).toBe(1);
    const search = await provider.handle("history/search", { query: "provider", limit: 5 });
    expect(search.results[0].content_preview).toContain("bounded preview");
    expect(search.results[0]).not.toHaveProperty("content");
    const conversation = await provider.handle("history/conversation", { conversation_hid: "conversation/1" });
    expect(conversation.conversation.messages[0].content).toBe("Bounded message");
    const context = await provider.handle("context/build", { query: "provider", budget: 1000 });
    expect(context.markdown).toContain("provider");
    const imported = await provider.handle("history/import-export", {
      input_path: "/tmp/chatgpt-export.zip",
      include_raw_files: false,
    });
    expect(imported.commit_oid).toBe("d".repeat(40));
    expect(calls.some(([kind]) => kind === "import")).toBe(true);
    const pushed = await provider.handle("history/sync-push", { state: companionState, expected_head: null });
    expect(pushed.head).toBe("a".repeat(40));
  });

  test("routes provider operations through the existing allowed native caller boundary", async () => {
    const calls = [];
    const provider = {
      protocol: "historia.native-provider/0-alpha",
      operations: HISTORIA_NATIVE_PROVIDER_OPERATIONS,
      handle: async (op, payload) => {
        calls.push([op, payload]);
        return { op, payload };
      },
    };
    const caller = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
    const handler = createNativeCollectHandler({
      caller,
      allowedCallers: [caller],
      provider,
      vaultPath: "/tmp/unused-vault.git",
      databasePath: "/tmp/unused-index.sqlite",
    });
    const ping = await handler({ protocol_version: "1.0", request_id: "provider-ping", op: "ping" });
    expect(ping.result.capabilities).toContain("history/search");
    const response = await handler({
      protocol_version: "1.0",
      request_id: "provider-search",
      op: "history/search",
      payload: { query: "Hara" },
    });
    expect(response.result).toEqual({ op: "history/search", payload: { query: "Hara" } });
    expect(calls).toEqual([["history/search", { query: "Hara" }]]);
  });
});
