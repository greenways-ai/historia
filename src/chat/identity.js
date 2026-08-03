import { createHash } from "node:crypto";

function normalizeCanonical(value, inArray = false) {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) {
    return { $binary: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  }
  if (value instanceof ArrayBuffer) return { $binary: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map((item) => normalizeCanonical(item, true));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeCanonical(value[key], false);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  return String(value);
}

export function canonicalValue(value) {
  return normalizeCanonical(value, false);
}

export function canonicalJson(value, { newline = true } = {}) {
  const text = JSON.stringify(canonicalValue(value));
  return newline ? `${text}\n` : text;
}

export function sha256(value) {
  const hash = createHash("sha256");
  if (typeof value === "string" || Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    hash.update(value);
  } else {
    hash.update(canonicalJson(value, { newline: false }));
  }
  return hash.digest("hex");
}

function idPart(value) {
  return encodeURIComponent(String(value ?? "unknown"));
}

export function historiaId(provider, sourceKey, kind, providerId) {
  return `historia:${idPart(provider)}:${idPart(sourceKey)}:${idPart(kind)}:${idPart(providerId)}`;
}

export function sourceKeyFor(provider, identity) {
  return `${provider}-${sha256(`${provider}\0${String(identity ?? "default")}`).slice(0, 24)}`;
}

export function digestPath(prefix, digest, filename = "record.json") {
  if (!/^[a-f0-9]{32,128}$/i.test(digest)) throw new Error(`invalid digest: ${digest}`);
  return `${prefix}/${digest.slice(0, 2)}/${digest}/${filename}`;
}

export function pathKey(value, length = 40) {
  return sha256(String(value)).slice(0, length);
}
