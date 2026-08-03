import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveOpenAIExport } from "../src/chat/archive.js";
import { inspectOpenAIExport } from "../src/chat/openai-export.js";
import { GitVault } from "../src/vault/git-writer.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export", import.meta.url));

describe("Historia chat archive", () => {
  test("normalizes ChatGPT exports as branch-aware conversation graphs", async () => {
    const result = await inspectOpenAIExport(fixture);
    expect(result.stats).toMatchObject({ conversations: 1, messages: 4, branch_points: 1 });
    const conversation = result.conversations[0];
    expect(conversation.active_paths[0]).toHaveLength(3);
    expect(conversation.edges).toHaveLength(3);
    const regenerated = conversation.messages.find((message) => message.nodeId === "a2");
    expect(regenerated.normalized.blocks[0]).toEqual({ type: "text", text: "Use reachable Git blobs and a rebuildable index.", provider_type: "multimodal_text" });
    expect(regenerated.normalized.blocks[1]).toMatchObject({ type: "image", asset_pointer: "file-service://asset-1" });
  });

  test("commits a reachable, idempotent import into a bare Git vault", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chat-test-"));
    try {
      const vaultPath = join(root, "vault.git");
      const first = await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-04T00:00:00Z" });
      const second = await archiveOpenAIExport({ inputPath: fixture, vaultPath, importedAt: "2026-08-04T01:00:00Z" });
      expect(first.idempotent).toBe(false);
      expect(second.idempotent).toBe(true);
      expect(second.commitOid).toBe(first.commitOid);

      const vault = await GitVault.init(vaultPath);
      const manifest = JSON.parse(await vault.readText(first.ref, first.paths.conversations[0]));
      const receipt = JSON.parse(await vault.readText(first.ref, first.receiptPath));
      expect(Object.keys(manifest.nodes)).toHaveLength(4);
      expect(manifest.active_paths[0]).toHaveLength(3);
      expect(receipt.stats.messages).toBe(4);
      expect(receipt.archive.manifest_path).toContain("raw/exports/");
      expect((await vault.verify()).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves earlier message revisions when an export changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-chat-update-test-"));
    try {
      const exportPath = join(root, "export");
      await cp(fixture, exportPath, { recursive: true });
      const vaultPath = join(root, "vault.git");
      const first = await archiveOpenAIExport({ inputPath: exportPath, vaultPath, importedAt: "2026-08-04T00:00:00Z" });

      const conversationsPath = join(exportPath, "conversations.json");
      const conversations = JSON.parse(await readFile(conversationsPath, "utf8"));
      conversations[0].mapping.a2.message.content.parts[0] = "Use reachable Git blobs, signed import receipts, and a rebuildable index.";
      conversations[0].update_time += 60;
      await writeFile(conversationsPath, `${JSON.stringify(conversations, null, 2)}\n`);

      const second = await archiveOpenAIExport({ inputPath: exportPath, vaultPath, importedAt: "2026-08-04T02:00:00Z" });
      expect(second.idempotent).toBe(false);
      expect(second.previousCommitOid).toBe(first.commitOid);
      expect(second.commitOid).not.toBe(first.commitOid);

      const vault = await GitVault.init(vaultPath);
      const firstManifest = JSON.parse(await vault.readText(first.commitOid, first.paths.conversations[0]));
      const secondManifest = JSON.parse(await vault.readText(second.commitOid, second.paths.conversations[0]));
      const messageHid = Object.keys(firstManifest.nodes).find((hid) => hid.endsWith(":message-assistant-2"));
      expect(secondManifest.nodes[messageHid].revision_oid).not.toBe(firstManifest.nodes[messageHid].revision_oid);
      expect(await vault.readText(first.commitOid, firstManifest.nodes[messageHid].path)).toContain("rebuildable index");
      expect(await vault.readText(second.commitOid, secondManifest.nodes[messageHid].path)).toContain("signed import receipts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
