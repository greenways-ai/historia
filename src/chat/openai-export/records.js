import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DEFAULT_MAX_JSON_BYTES } from "./limits.js";

export function conversationFiles(prepared) {
  if (prepared.explicitJson) return prepared.files.filter((file) => file.absolutePath === prepared.explicitJson);
  return prepared.files.filter((file) => /^conversations(?:[-_]?\d+)?\.json$/i.test(basename(file.relativePath)));
}

export function sourceMetadataFile(prepared) {
  return prepared.files.find((file) => ["user.json", "account.json"].includes(basename(file.relativePath).toLowerCase()));
}

export function payloadConversations(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.conversations)) return payload.conversations;
  if (payload && typeof payload === "object" && (payload.mapping || payload.conversation_id || payload.id)) return [payload];
  throw new Error("unrecognized ChatGPT conversations JSON structure");
}

export async function readJson(file, maxBytes = DEFAULT_MAX_JSON_BYTES) {
  if (file.size > maxBytes) throw new Error(`${file.relativePath} exceeds the JSON import limit of ${maxBytes} bytes`);
  try {
    return JSON.parse(await readFile(file.absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to parse ${file.relativePath}: ${error.message}`);
  }
}
