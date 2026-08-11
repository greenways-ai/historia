import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

const schema = (path) => Bun.file(path).json();

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate(value) { return !Number.isNaN(new Date(value).valueOf()); }
  });
  ajv.addFormat("uri", {
    type: "string",
    validate(value) { try { new URL(value); return true; } catch { return false; } }
  });
  return ajv;
}

describe("Historia chat schemas", () => {
  test("compile together and validate archive, browser, native, and context records", async () => {
    const ajv = validator();
    const schemas = await Promise.all([
      schema("spec/chat-source-v1.schema.json"),
      schema("spec/chat-message-v1.schema.json"),
      schema("spec/chat-conversation-v1.schema.json"),
      schema("spec/chat-import-receipt-v1.schema.json"),
      schema("spec/raw-export-manifest-v1.schema.json"),
      schema("spec/browser-observation-v1.schema.json")
    ]);
    for (const item of schemas) ajv.addSchema(item);
    const [sourceSchema, messageSchema, conversationSchema, receiptSchema, rawExportSchema, browserSchema] = schemas;
    for (const item of [sourceSchema, messageSchema, conversationSchema, receiptSchema, rawExportSchema, browserSchema]) {
      expect(ajv.getSchema(item.$id)).toBeDefined();
    }

    const [nativeSchema, contextSchema] = await Promise.all([
      schema("spec/native-collect-protocol-v1.schema.json"),
      schema("spec/chat-context-bundle-v1.schema.json")
    ]);
    const validateNative = ajv.compile(nativeSchema);
    const validateBrowser = ajv.getSchema(browserSchema.$id);
    const validateContext = ajv.compile(contextSchema);
    const validateReceipt = ajv.getSchema(receiptSchema.$id);

    const observation = {
      $schema: "historia.collect.browser-observation/0-alpha",
      provider: "openai",
      source_key: "browser-profile",
      observed_at: "2026-08-04T04:00:00Z",
      collector: { name: "historia-collect-extension", version: "0.1.0" },
      conversation: { id: "conversation-1", title: "Historia", url: "https://chatgpt.com/c/conversation-1", created_at: null, updated_at: null },
      messages: [{
        id: "message-1",
        role: "user",
        author: { kind: "user" },
        model: null,
        created_at: null,
        updated_at: null,
        blocks: [{ type: "text", text: "Remember this." }],
        parents: [],
        attachments: [],
        state: { rendered: true }
      }],
      active_path: ["message-1"]
    };
    expect(validateBrowser(observation)).toBe(true);
    expect(validateNative({ protocol_version: "1.0", request_id: "capture-1", op: "capture", observation, options: { index: true } })).toBe(true);
    expect(validateNative({ protocol_version: "1.0", request_id: "capture-2", op: "capture" })).toBe(false);

    const receipt = {
      $schema: "historia.chat.import-receipt/0-alpha",
      provider: "openai",
      source_key: "source-1",
      source_ref: "refs/historia/sources/openai/source-1",
      source_completeness: "full-account-export",
      archive: { sha256: "a".repeat(64), container_sha256: null, byte_count: 1, file_count: 1, manifest_path: "raw/exports/a/manifest.json" },
      importer: { name: "test", version: "1.0.0" },
      observed_at: "2026-08-04T04:00:00Z",
      previous_commit_oid: null,
      include_raw_files: true,
      stats: { conversations: 1, messages: 1, branch_points: 0, files: 1, bytes: 1, normalized_message_blobs: 1, raw_message_blobs: 1, conversation_manifests: 1 },
      warnings: []
    };
    expect(validateReceipt(receipt)).toBe(true);
    expect(validateReceipt({ ...receipt, source_ref: "refs/historia/private/source-1" })).toBe(false);

    expect(validateContext({
      $schema: "historia.chat.context-bundle/0-alpha",
      generated_at: "2026-08-04T04:05:00Z",
      query: "Historia",
      budget: { requested_tokens: 1000, estimated_tokens: 0, estimator: "utf8-bytes-divided-by-four" },
      filters: {},
      vault_heads: [],
      matches: { search_results: 0, conversation_snapshots: 0, included_messages: 0 },
      conversations: [],
      citations: []
    })).toBe(true);
  });
});
