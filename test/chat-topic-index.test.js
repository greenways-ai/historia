import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveOpenAIExport } from "../src/chat/archive.js";
import { buildChatContext, formatChatContextMarkdown } from "../src/chat/context.js";
import { openChatIndex } from "../src/chat/index-storage.js";
import { indexHistoriaChats } from "../src/chat/indexer.js";
import { searchChatIndex } from "../src/chat/search.js";
import { analyzeMessageTextGraph } from "../src/chat/text-graph.js";
import { indexMissingMessageTextGraphs } from "../src/chat/text-graph-storage.js";
import {
  indexMissingGraphTopics,
  topicIndexCounts,
  topicQueryPlan,
  topicsFromTextGraph
} from "../src/chat/topic-index.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export", import.meta.url));

describe("Historia graph-backed topic index", () => {
  test("links topic mentions to graph nodes and carries graph facets into ranking signals", () => {
    const message = {
      $schema: "historia.chat.message/0-alpha",
      hid: "historia:openai:test:message:m1",
      source: {
        provider: "openai",
        source_kind: "test",
        source_key: "test",
        conversation_id: "c1",
        message_id: "m1"
      },
      role: "user",
      author: { kind: "user", display_name: null },
      blocks: [{
        type: "text",
        text: "We should link Historia topics to private agent rooms for better ranked searches."
      }],
      parents: [],
      attachments: []
    };
    const graph = analyzeMessageTextGraph(message, { revisionOid: "a".repeat(40) });
    const topics = topicsFromTextGraph(graph);
    const historia = topics.find((topic) => topic.kind === "project" && topic.label === "Historia");
    const phrase = topics.find((topic) => topic.normalized_key === "private agent rooms");
    expect(historia).toBeTruthy();
    expect(historia.graph_node_id).toMatch(/^historia:text-node:/);
    expect(historia.context_node_id).toMatch(/^historia:text-node:/);
    expect(historia.support_node_ids.length).toBeGreaterThan(1);
    expect(historia.facets).toContain("proposal");
    expect(historia.weight).toBeGreaterThan(1.7);
    expect(phrase).toBeTruthy();
    expect(phrase.facets).toContain("proposal");
    expect(topicsFromTextGraph(graph)).toEqual(topics);
  });

  test("uses one-hop topic associations to retrieve related messages without hiding lexical provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-topic-index-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-06T00:00:00Z" });
      await indexHistoriaChats({ vaultPath, databasePath });

      const db = await openChatIndex(databasePath);
      try {
        expect(indexMissingMessageTextGraphs(db).indexed).toBe(4);
        const first = indexMissingGraphTopics(db);
        const second = indexMissingGraphTopics(db);
        expect(first.indexed).toBe(4);
        expect(first.associations_cached).toBe(false);
        expect(second.indexed).toBe(0);
        expect(second.associations_cached).toBe(true);
        expect(topicIndexCounts(db).topics).toBeGreaterThan(0);
        expect(topicIndexCounts(db).associations).toBeGreaterThan(0);

        const plan = topicQueryPlan(db, "raw provider record", {
          seedLimit: 8,
          relatedLimit: 24,
          messageLimit: 50
        });
        expect(plan.seeds.length).toBeGreaterThan(0);
        expect(plan.related.length).toBeGreaterThan(0);
        expect(plan.candidates.some((candidate) => candidate.associated_topics.length > 0)).toBe(true);

        const lexical = searchChatIndex(db, "raw provider record", { limit: 20 });
        expect(lexical.some((result) => result.content.includes("reachable Git blobs"))).toBe(false);

        const expanded = searchChatIndex(db, "raw provider record", {
          limit: 20,
          expandTopics: true,
          topicLimit: 24
        });
        const related = expanded.find((result) => result.content.includes("reachable Git blobs"));
        expect(related).toBeTruthy();
        expect(related.retrieval.mode).toBe("lexical+topics");
        expect(related.retrieval.lexical).toBeNull();
        expect(related.retrieval.topics.associated_topics.length).toBeGreaterThan(0);
        expect(related.retrieval.topics.graph_node_ids.length).toBeGreaterThan(0);

        const bundle = buildChatContext(db, "raw provider record", {
          budget: 4_000,
          expandTopics: true,
          topicLimit: 24,
          generatedAt: "2026-08-06T03:00:00Z"
        });
        expect(bundle.filters.expand_topics).toBe(true);
        expect(bundle.conversations.flatMap((conversation) => conversation.messages)
          .some((message) => message.retrieval.some((retrieval) => retrieval.associated_topics.length > 0))).toBe(true);
        expect(formatChatContextMarkdown(bundle)).toContain("related topics:");
      } finally {
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
