import { canonicalJson } from "./identity.js";

function dataText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return canonicalJson(value, { newline: false });
}

function plainBlock(block = {}) {
  const type = block.type ?? "provider";
  if (type === "text" || type === "code") return String(block.text ?? "");
  if (type === "image") return `[image${block.asset_pointer ? `: ${block.asset_pointer}` : ""}]`;
  if (type === "audio") return `[audio${block.asset_pointer ? `: ${block.asset_pointer}` : ""}]`;
  if (type === "file") return `[file${block.asset_pointer ? `: ${block.asset_pointer}` : ""}]`;
  if (type === "citation") return String(block.text ?? block.url ?? dataText(block.data) ?? "[citation]");
  if (type === "tool-call") return `[tool call] ${String(block.text ?? dataText(block.data))}`.trim();
  if (type === "tool-result") return `[tool result] ${String(block.text ?? dataText(block.data))}`.trim();
  return String(block.text ?? dataText(block.data) ?? "");
}

function markdownFence(text) {
  const runs = String(text).match(/`+/g) ?? [];
  const longest = runs.reduce((max, value) => Math.max(max, value.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function markdownBlock(block = {}) {
  if (block.type !== "code") return plainBlock(block);
  const text = String(block.text ?? "");
  const fence = markdownFence(text);
  return `${fence}${block.language ?? ""}\n${text}\n${fence}`;
}

export function renderMessageBlocks(blocks, { markdown = false } = {}) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => markdown ? markdownBlock(block) : plainBlock(block))
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function messageSearchText(message = {}) {
  return renderMessageBlocks(message.blocks, { markdown: false });
}

export function messageMarkdown(message = {}) {
  return renderMessageBlocks(message.blocks, { markdown: true });
}

export function estimateTokens(value) {
  const bytes = Buffer.byteLength(String(value ?? ""), "utf8");
  return Math.max(1, Math.ceil(bytes / 4));
}

export function truncateToEstimatedTokens(value, maxTokens) {
  const text = String(value ?? "");
  const budget = Math.max(0, Number(maxTokens) || 0);
  if (!text || budget <= 0) return { text: "", truncated: Boolean(text), estimatedTokens: 0 };
  if (estimateTokens(text) <= budget) return { text, truncated: false, estimatedTokens: estimateTokens(text) };

  const suffix = "\n\n[…truncated by Historia context budget…]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const maxBytes = Math.max(0, budget * 4 - suffixBytes);
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > maxBytes) break;
    result += character;
    bytes += width;
  }
  const output = `${result.trimEnd()}${suffix}`;
  return {
    text: output,
    truncated: true,
    estimatedTokens: Math.min(budget, estimateTokens(output))
  };
}

export function displayRole(role) {
  const value = String(role ?? "unknown");
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unknown";
}
