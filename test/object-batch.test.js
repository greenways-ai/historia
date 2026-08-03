import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitVault } from "../src/vault/git-writer.js";
import { readGitJsonObjectsBatched } from "../src/vault/object-batch.js";

describe("bounded Git JSON reads", () => {
  test("reads JSON blobs and rejects objects above the configured index limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-object-batch-"));
    try {
      const vault = await GitVault.init(join(root, "vault.git"));
      const oid = await vault.writeBlob('{"message":"bounded"}\n');
      const objects = await readGitJsonObjectsBatched(vault.repository, [oid], { maxObjectBytes: 1024, maxBatchBytes: 1024 });
      expect(objects.get(oid).json).toEqual({ message: "bounded" });
      await expect(readGitJsonObjectsBatched(vault.repository, [oid], { maxObjectBytes: 4, maxBatchBytes: 4 }))
        .rejects.toThrow("indexing limit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
