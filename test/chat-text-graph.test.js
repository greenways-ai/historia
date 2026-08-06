import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveOpenAIExport } from "../src/chat/archive.js";
import { openChatIndex } from "../src/chat/index-storage.js";
import { indexHistoriaChats } from "../src/chat/indexer.js";
import {
  analyzeMessageTextGraph,
  projectTextGraph
} from "../src/chat/text-graph.js";
import {
  indexMissingMessageTextGraphs,
  loadMessageTextGraph,
  textGraphCounts
} from "../src/chat/text-graph-storage.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export", import.meta.url));

function schemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv;
}

function sourceSlice(message, anchor) {
  return Buffer.from(message.blocks[anchor.block_index].text ?? "", "utf8")
    .subarray(anchor.start_byte, anchor.end_byte)
    .toString("utf8");
}

describe("Historia text graphs", () => {
  test("builds deterministic, byte-anchored source, concept, and work projections", async () => {
    const message = {
      $schema: "historia.chat.message/v1",
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
      blocks: [
        {
          type: "text",
          text: "🦚 I'd like Historia to project a graph from Hestia decisions. I don't want the typical crypto framing. Can you update greenways-ai/historia?"
        },
        { type: "code", language: "clojure", text: "(def graph {})" }
      ],
      parents: [],
      attachments: []
    };
    const revisionOid = "a".repeat(40);
    const graph = analyzeMessageTextGraph(message, { revisionOid });
    expect(analyzeMessageTextGraph(message, { revisionOid })).toEqual(graph);
    expect(graph.$schema).toBe("historia.text.graph/v1");
    expect(graph.document.revision_oid).toBe(revisionOid);
    expect(graph.nodes.some((node) => node.kind === "request")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "rejection")).toBe(true);
    expect(graph.nodes.some((node) => node.properties?.canonical_key === "project:greenways-ai/historia")).toBe(true);
    expect(graph.nodes.some((node) => node.properties?.canonical_key === "repository:greenways-ai/historia")).toBe(true);

    const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
    const anchorIds = new Set(graph.anchors.map((anchor) => anchor.anchor_id));
    for (const anchor of graph.anchors) {
      expect(sourceSlice(message, anchor)).toBe(anchor.exact);
    }
    for (const node of graph.nodes) {
      for (const anchorId of node.anchor_ids) expect(anchorIds.has(anchorId)).toBe(true);
    }
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
      for (const anchorId of edge.anchor_ids) expect(anchorIds.has(anchorId)).toBe(true);
    }

    const source = projectTextGraph(graph, "source");
    const concepts = projectTextGraph(graph, "concepts");
    const work = projectTextGraph(graph, "work");
    expect(source.nodes.every((node) => node.layer === "source")).toBe(true);
    expect(concepts.nodes.every((node) => ["reference", "semantic"].includes(node.layer))).toBe(true);
    expect(work.nodes.some((node) => node.layer === "work")).toBe(true);
    expect(work.nodes.some((node) => node.layer === "semantic")).toBe(true);
    expect(work.nodes.some((node) => node.layer === "source")).toBe(false);

    const structuralA = analyzeMessageTextGraph({
      ...message,
      blocks: [{ type: "text", text: "Historia should project graphs." }]
    }, { revisionOid: "b".repeat(40) });
    const structuralB = analyzeMessageTextGraph({
      ...message,
      blocks: [{ type: "text", text: "Historia should project graphs!" }]
    }, { revisionOid: "c".repeat(40) });
    expect(structuralA.nodes.find((node) => node.kind === "proposition").structural_hash)
      .toBe(structuralB.nodes.find((node) => node.kind === "proposition").structural_hash);

    const ajv = schemaValidator();
    const graphSchema = await Bun.file("spec/text-graph-v1.schema.json").json();
    const projectionSchema = await Bun.file("spec/text-projection-v1.schema.json").json();
    ajv.addSchema(graphSchema);
    expect(ajv.getSchema(graphSchema.$id)(graph)).toBe(true);
    expect(ajv.compile(projectionSchema)(work)).toBe(true);
  });

  test("persists one graph per immutable message revision and rebuilds it from the chat index", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-text-graph-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-06T00:00:00Z" });
      await indexHistoriaChats({ vaultPath, databasePath });

      let revisionIdentifier;
      let db = await openChatIndex(databasePath);
      try {
        const first = indexMissingMessageTextGraphs(db);
        const second = indexMissingMessageTextGraphs(db);
        expect(first.indexed).toBe(4);
        expect(second.indexed).toBe(0);
        expect(textGraphCounts(db).graphs).toBe(4);

        const revision = db.query(`
          SELECT revision_oid, message_hid
          FROM chat_message_revisions
          WHERE content_text LIKE '%Historia%'
          ORDER BY rowid LIMIT 1
        `).get();
        revisionIdentifier = revision.revision_oid;
        const graph = loadMessageTextGraph(db, revision.revision_oid);
        const byMessage = loadMessageTextGraph(db, revision.message_hid, { projection: "concepts" });
        expect(graph.document.revision_oid).toBe(revision.revision_oid);
        expect(graph.nodes.some((node) => node.properties?.canonical_key === "project:greenways-ai/historia")).toBe(true);
        expect(byMessage.$schema).toBe("historia.text.projection/v1");
      } finally {
        db.close();
      }

      const cli = Bun.spawnSync([
        process.execPath,
        join(process.cwd(), "src/historia-cli.js"),
        "graph",
        "show",
        revisionIdentifier,
        "--projection",
        "concepts",
        "--vault",
        vaultPath,
        "--database",
        databasePath,
        "--no-index"
      ], { stdout: "pipe", stderr: "pipe" });
      expect(cli.exitCode).toBe(0);
      expect(JSON.parse(cli.stdout.toString("utf8")).$schema).toBe("historia.text.projection/v1");

      await indexHistoriaChats({ vaultPath, databasePath, rebuild: true });
      db = await openChatIndex(databasePath);
      try {
        expect(textGraphCounts(db).graphs).toBe(0);
        expect(indexMissingMessageTextGraphs(db).indexed).toBe(4);
        expect(textGraphCounts(db).graphs).toBe(4);
      } finally {
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
