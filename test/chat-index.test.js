import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveOpenAIExport } from "../src/chat/archive.js";
import { buildChatContext, formatChatContextMarkdown } from "../src/chat/context.js";
import { openChatIndex } from "../src/chat/index-storage.js";
import { indexHistoriaChats } from "../src/chat/indexer.js";
import { loadConversationSnapshot, searchChatIndex } from "../src/chat/search.js";
import { GitVault } from "../src/vault/git-writer.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export", import.meta.url));

describe("Historia chat retrieval", () => {
  test("rebuilds a searchable SQLite projection and emits provenance-rich context", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chat-index-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      const archived = await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-04T00:00:00Z" });
      const indexed = await indexHistoriaChats({ vaultPath, databasePath });
      expect(indexed).toMatchObject({ commits: 1, imports: 1, new_revisions: 4 });
      expect(indexed.counts).toMatchObject({ conversations: 1, message_identities: 4, message_revisions: 4 });

      const db = await openChatIndex(databasePath);
      try {
        const results = searchChatIndex(db, "reachable Git blobs", { limit: 10 });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].provenance.commit_oid).toBe(archived.commitOid);
        expect(results[0].provenance.source_ref).toBe(archived.ref);
        expect(results[0].provenance.message_path).toMatch(/^messages\//);

        const snapshot = loadConversationSnapshot(db, results[0].conversation_hid, {
          sourceRef: archived.ref,
          commitOid: archived.commitOid
        });
        expect(snapshot.messages).toHaveLength(4);
        expect(snapshot.active_paths[0]).toHaveLength(3);

        const bundle = buildChatContext(db, "reachable Git blobs", {
          budget: 2_000,
          radius: 1,
          generatedAt: "2026-08-04T03:00:00Z"
        });
        expect(bundle.$schema).toBe("historia.chat.context-bundle/0-alpha");
        expect(bundle.citations.length).toBeGreaterThan(0);
        expect(bundle.citations[0]).toMatchObject({ source_ref: archived.ref, commit_oid: archived.commitOid });
        expect(bundle.citations[0].message_path).toMatch(/^messages\//);
        expect(formatChatContextMarkdown(bundle)).toContain("## Provenance");
      } finally {
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("indexes only changed message revisions and retains historical search provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chat-index-update-test-"));
    try {
      const exportPath = join(root, "export");
      await cp(fixture, exportPath, { recursive: true });
      const vaultPath = join(root, "vault.git");
      const databasePath = join(root, "chat-index.sqlite");
      const first = await archiveOpenAIExport({ inputPath: exportPath, vaultPath, importedAt: "2026-08-04T00:00:00Z" });
      await indexHistoriaChats({ vaultPath, databasePath });

      const conversationsPath = join(exportPath, "conversations.json");
      const conversations = JSON.parse(await readFile(conversationsPath, "utf8"));
      conversations[0].mapping.a2.message.content.parts[0] = "Use reachable Git blobs and signed receipts.";
      conversations[0].update_time += 60;
      await writeFile(conversationsPath, `${JSON.stringify(conversations, null, 2)}\n`);

      const second = await archiveOpenAIExport({ inputPath: exportPath, vaultPath, importedAt: "2026-08-04T02:00:00Z" });
      const updated = await indexHistoriaChats({ vaultPath, databasePath });
      expect(updated).toMatchObject({ rebuilt: false, commits: 1, new_revisions: 1 });

      const vault = await GitVault.init(vaultPath);
      const firstManifest = JSON.parse(await vault.readText(first.commitOid, first.paths.conversations[0]));
      const secondManifest = JSON.parse(await vault.readText(second.commitOid, second.paths.conversations[0]));
      const unchangedHid = Object.entries(firstManifest.nodes).find(([, node]) => node.node_id === "u1")?.[0];
      const changedHid = Object.entries(firstManifest.nodes).find(([, node]) => node.node_id === "a2")?.[0];
      expect(secondManifest.nodes[unchangedHid].revision_oid).toBe(firstManifest.nodes[unchangedHid].revision_oid);
      expect(secondManifest.nodes[changedHid].revision_oid).not.toBe(firstManifest.nodes[changedHid].revision_oid);

      let db = await openChatIndex(databasePath);
      try {
        expect(db.query("SELECT COUNT(*) AS count FROM chat_message_revisions").get().count).toBe(5);
        const currentOldResults = searchChatIndex(db, "rebuildable", { limit: 10 });
        const historicalOldResults = searchChatIndex(db, "rebuildable", { limit: 10, historical: true });
        const newResults = searchChatIndex(db, "signed receipts", { limit: 10 });
        expect(currentOldResults).toHaveLength(0);
        expect(historicalOldResults.some((result) => result.provenance.commit_oid === first.commitOid)).toBe(true);
        expect(newResults.some((result) => result.provenance.commit_oid === second.commitOid)).toBe(true);
      } finally {
        db.close();
      }

      const rebuilt = await indexHistoriaChats({ vaultPath, databasePath, rebuild: true });
      expect(rebuilt.rebuilt).toBe(true);
      expect(rebuilt.counts.message_revisions).toBe(5);
      db = await openChatIndex(databasePath);
      try {
        expect(searchChatIndex(db, "signed receipts", { limit: 10 }).length).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
