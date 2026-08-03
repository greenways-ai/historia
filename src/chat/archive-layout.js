import { digestPath, pathKey, sha256 } from "./identity.js";

function providerSegment(provider) {
  const value = String(provider ?? "unknown").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`invalid Historia provider segment: ${provider}`);
  return value;
}


export function assertHistoriaSourceRef(ref) {
  const value = String(ref ?? "");
  if (!value.startsWith("refs/historia/sources/")
      || !/^refs\/[A-Za-z0-9._/-]+$/.test(value)
      || value.includes("..")
      || value.includes("//")
      || value.endsWith("/")) {
    throw new Error(`invalid Historia source ref: ${value || "missing"}`);
  }
  return value;
}

export function historiaSourceRef(provider, sourceKey) {
  return `refs/historia/sources/${providerSegment(provider)}/${pathKey(sourceKey, 32)}`;
}

export function historiaSourcePath(provider, sourceKey) {
  return `sources/${providerSegment(provider)}/${pathKey(sourceKey, 40)}/source.json`;
}

export function messageArchivePaths(normalizedOid, rawOid) {
  return {
    normalized: digestPath("messages", normalizedOid, "message.json"),
    raw: digestPath("raw/messages", rawOid, "message.json")
  };
}

export function conversationArchivePaths(hid, rawOid) {
  const key = sha256(hid);
  return {
    manifest: `conversations/${key.slice(0, 2)}/${key}/manifest.json`,
    raw: digestPath("raw/conversations", rawOid, "conversation.json")
  };
}
