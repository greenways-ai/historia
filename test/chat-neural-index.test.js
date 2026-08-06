import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveOpenAIExport } from "../src/chat/archive.js";
import {
  blobToVector,
  cosineSimilarity,
  createPrototypeClassifier,
  vectorToBlob
} from "../src/chat/neural-classifier.js";
import {
  indexNeuralProjection,
  neuralIndexCounts,
  neuralIndexStatus,
  searchNeuralTopics
} from "../src/chat/neural-index.js";
import { openChatIndex } from "../src/chat/index-storage.js";
import { indexHistoriaChats } from "../src/chat/indexer.js";
import { indexMissingMessageTextGraphs } from "../src/chat/text-graph-storage.js";
import { indexMissingGraphTopics } from "../src/chat/topic-index.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export", import.meta.url));

const groups = [
  ["reachable", "accessible", "access", "retrievable"],
  ["git", "repository", "archive"],
  ["blob", "blobs", "object", "objects"],
  ["raw", "provider", "record", "records", "source"],
  ["signed", "receipt", "receipts", "provenance"],
  ["question", "asking", "information", "why", "what", "how"],
  ["request", "action", "perform", "proposal", "suggestion"],
  ["decision", "chosen", "constraint", "requirement", "rationale", "reason"]
];

function fakeEmbedding(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) ?? [];
  const vector = new Array(groups.length).fill(0.01);
  for (const word of words) {
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].includes(word)) vector[index] += 1;
    }
  }
  return vector;
}

function fakeClassifier() {
  return createPrototypeClassifier({
    descriptor: {
      runtime: "test",
      runtime_module: "test/fake-encoder",
      model_id: "historia-test-encoder",
      model_revision: "fixture-v1",
      device: "test",
      dtype: "float32",
      pooling: "mean",
      normalize: true,
      dimensions: groups.length
    },
    embed: async (texts) => texts.map(fakeEmbedding)
  });
}

describe("Historia neural topic classifier", () => {
  test("round-trips normalized float32 vectors", () => {
    const vector = new Float32Array([0.25, -0.5, 0.75]);
    const decoded = blobToVector(vectorToBlob(vector), 3);
    expect([...decoded]).toEqual([...vector]);
    expect(cosineSimilarity(vector, decoded)).toBeCloseTo(1, 6);
  });

  test("indexes immutable messages and topics once, then retrieves semantic topic matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-neural-index-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-06T00:00:00Z" });
      await indexHistoriaChats({ vaultPath, databasePath });
      const db = await openChatIndex(databasePath);
      const classifier = fakeClassifier();
      try {
        expect(indexMissingMessageTextGraphs(db).indexed).toBe(4);
        expect(indexMissingGraphTopics(db).indexed).toBe(4);

        const first = await indexNeuralProjection(db, classifier, { batchSize: 2 });
        const second = await indexNeuralProjection(db, classifier, { batchSize: 2 });
        expect(first.messages).toBe(4);
        expect(first.topics).toBeGreaterThan(0);
        expect(second.messages).toBe(0);
        expect(second.topics).toBe(0);
        expect(neuralIndexCounts(db, classifier.descriptor.fingerprint)).toMatchObject({
          models: 1,
          message_vectors: 4
        });
        expect(neuralIndexStatus(db)[0]).toMatchObject({
          model_id: "historia-test-encoder",
          message_vectors: 4
        });

        const result = await searchNeuralTopics(db, "accessible repository objects", classifier, {
          topicLimit: 12,
          relatedLimit: 12,
          minSimilarity: 0.2,
          limit: 20
        });
        expect(result.model.fingerprint).toBe(classifier.descriptor.fingerprint);
        expect(result.topics.some((topic) => topic.label.toLowerCase().includes("reachable git blobs"))).toBe(true);
        const matched = result.results.find((row) => row.content.toLowerCase().includes("reachable git blobs"));
        expect(matched).toBeTruthy();
        expect(matched.signals.message_similarity).toBeGreaterThan(0.5);
        expect(matched.signals.direct_topics.length).toBeGreaterThan(0);
        expect(matched.provenance.commit_oid).toBeTruthy();
      } finally {
        await classifier.dispose();
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
