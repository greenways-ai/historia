import { canonicalJson } from "../identity.js";

export function openAITimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function providerBlock(part, providerType) {
  if (typeof part === "string") {
    if (providerType === "code") return { type: "code", language: null, text: part, provider_type: providerType };
    const block = { type: "text", text: part };
    if (!["text", "unknown"].includes(providerType)) block.provider_type = providerType;
    return block;
  }
  if (part === null || part === undefined) return { type: "provider", provider_type: providerType, data: part };
  if (typeof part !== "object") return { type: "text", text: String(part) };

  const partType = part.content_type ?? part.type ?? providerType;
  const text = part.text ?? part.content ?? part.result ?? null;
  if (partType === "image_asset_pointer" || part.asset_pointer || part.image_url) {
    return {
      type: "image",
      asset_pointer: part.asset_pointer ?? part.image_url ?? null,
      width: part.width ?? null,
      height: part.height ?? null,
      provider_type: partType,
      metadata: part.metadata ?? null
    };
  }
  if (String(partType).includes("audio")) {
    return { type: "audio", asset_pointer: part.asset_pointer ?? part.audio_url ?? null, provider_type: partType, data: part };
  }
  if (String(partType).includes("code") || part.language) {
    return { type: "code", language: part.language ?? null, text: text === null ? canonicalJson(part, { newline: false }) : String(text), provider_type: partType };
  }
  if (text !== null && typeof text !== "object") return { type: "text", text: String(text), provider_type: partType };
  return { type: "provider", provider_type: partType, data: part };
}

export function normalizeOpenAIContent(content) {
  if (content === null || content === undefined) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.map((part) => providerBlock(part, "unknown"));
  const providerType = content.content_type ?? content.type ?? "unknown";
  const parts = Array.isArray(content.parts)
    ? content.parts
    : content.text !== undefined
      ? [content.text]
      : content.result !== undefined
        ? [content.result]
        : [];
  if (parts.length) return parts.map((part) => providerBlock(part, providerType));
  return [providerBlock(content, providerType)];
}
