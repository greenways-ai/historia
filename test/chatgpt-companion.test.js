import { describe, expect, test } from "bun:test";
import {
  CHAT_BOOKMARK_PROTOCOL,
  COMPANION_STATE_PROTOCOL,
  createBookmark,
  createPrompt,
  createSyncEnvelope,
  emptyCompanionState,
  importSyncEnvelope,
  mergeCompanionStates,
  normalizeChatGPTUrl,
  normalizeCompanionState,
  tombstoneRecord,
  visibleBookmarks,
  visiblePrompts,
} from "../extension/src/companion-state.js";
import { chatMetadataFromTab, resolveCompanionDestination } from "../extension/src/companion-routes.js";

const at = (value) => () => new Date(value);

describe("Historia ChatGPT companion state", () => {
  test("normalizes only conversation and shared-link URLs", () => {
    expect(normalizeChatGPTUrl("https://www.chatgpt.com/c/example_123?utm=bad#fragment")).toBe("https://chatgpt.com/c/example_123");
    expect(normalizeChatGPTUrl("https://chat.openai.com/share/example-456")).toBe("https://chatgpt.com/share/example-456");
    expect(() => normalizeChatGPTUrl("https://example.com/c/example_123")).toThrow(/not a ChatGPT address/);
    expect(() => normalizeChatGPTUrl("https://chatgpt.com/backend-api/conversations")).toThrow(/not a supported/);
  });

  test("creates bounded bookmark and prompt records", () => {
    const bookmark = createBookmark({ url: "https://chatgpt.com/c/example_123", title: "Design chat" }, {
      id: "bookmark/design-chat",
      now: at("2026-08-07T00:00:00.000Z"),
    });
    expect(bookmark.protocol).toBe(CHAT_BOOKMARK_PROTOCOL);
    const prompt = createPrompt({ title: "Review", text: "Review this architecture.", tags: ["work"] }, {
      id: "prompt/review-architecture",
      now: at("2026-08-07T00:00:01.000Z"),
    });
    expect(prompt.tags).toEqual(["work"]);
    expect(() => normalizeCompanionState({
      protocol: COMPANION_STATE_PROTOCOL,
      revision: 1,
      bookmarks: [{ ...bookmark, token: "never" }],
      prompts: [],
    })).toThrow(/unsupported field token|secret field token/);
  });

  test("merges metadata deterministically and retains tombstones", () => {
    const first = createBookmark({ url: "https://chatgpt.com/c/example_123", title: "Old title" }, {
      id: "bookmark/design-chat",
      now: at("2026-08-07T00:00:00.000Z"),
    });
    const updated = { ...first, title: "New title", updatedAt: "2026-08-07T01:00:00.000Z" };
    const deleted = tombstoneRecord(updated, at("2026-08-07T02:00:00.000Z"));
    const merged = mergeCompanionStates({
      protocol: COMPANION_STATE_PROTOCOL,
      revision: 1,
      bookmarks: [first],
      prompts: [],
    }, {
      protocol: COMPANION_STATE_PROTOCOL,
      revision: 2,
      bookmarks: [deleted],
      prompts: [],
    });
    expect(visibleBookmarks(merged)).toEqual([]);
  });

  test("round-trips portable sync metadata", () => {
    const prompt = createPrompt({ title: "Plan", text: "Make a plan." }, {
      id: "prompt/make-a-plan",
      now: at("2026-08-07T00:00:00.000Z"),
    });
    const state = normalizeCompanionState({
      protocol: COMPANION_STATE_PROTOCOL,
      revision: 4,
      bookmarks: [],
      prompts: [prompt],
    });
    const envelope = createSyncEnvelope(state, { exportedAt: "2026-08-07T03:00:00.000Z" });
    const imported = importSyncEnvelope(JSON.parse(JSON.stringify(envelope)), emptyCompanionState());
    expect(visiblePrompts(imported)[0].text).toBe("Make a plan.");
  });

  test("reads only reviewed active-tab metadata and destinations", () => {
    expect(chatMetadataFromTab({
      url: "https://chatgpt.com/c/example_123?utm=ignored",
      title: "System Design - ChatGPT",
    })).toEqual({
      url: "https://chatgpt.com/c/example_123",
      title: "System Design",
    });
    expect(chatMetadataFromTab({ url: "https://example.com/", title: "Other" })).toBeNull();
    expect(resolveCompanionDestination("archive")).toBe("http://127.0.0.1:4319/#archive");
    expect(() => resolveCompanionDestination("https://evil.example")).toThrow(/Unsupported/);
  });
});
