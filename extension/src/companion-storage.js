import {
  COMPANION_STATE_PROTOCOL,
  MAX_SYNC_BYTES,
  emptyCompanionState,
  importSyncEnvelope,
  mergeCompanionStates,
  normalizeCompanionState,
  tombstoneRecord,
  upsertBookmark,
  upsertPrompt,
} from "./companion-state.js";

export const COMPANION_STORAGE_KEY = "historiaChatGPTCompanion";
export const COMPANION_SYNC_ENABLED_KEY = "historiaChatGPTSyncEnabled";
export const COMPANION_SYNC_META_KEY = "historiaChatGPTSyncMeta";
export const COMPANION_SYNC_CHUNK_PREFIX = "historiaChatGPTSyncChunk:";
export const COMPANION_STORAGE_SYNC_PROTOCOL = "historia.chatgpt.storage-sync/1";

const SYNC_CHUNK_BYTES = 5 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function requireApi(extensionApi) {
  const api = extensionApi ?? globalThis.browser ?? globalThis.chrome;
  if (!api?.storage?.local) throw new Error("Browser extension storage is unavailable");
  return api;
}

function storageGet(area, keys, extensionApi) {
  if (globalThis.browser && extensionApi === globalThis.browser) return area.get(keys);
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      const error = extensionApi.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function storageSet(area, value, extensionApi) {
  if (globalThis.browser && extensionApi === globalThis.browser) return area.set(value);
  return new Promise((resolve, reject) => {
    area.set(value, () => {
      const error = extensionApi.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(area, keys, extensionApi) {
  if (!keys.length) return Promise.resolve();
  if (globalThis.browser && extensionApi === globalThis.browser) return area.remove(keys);
  return new Promise((resolve, reject) => {
    area.remove(keys, () => {
      const error = extensionApi.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storedState(value) {
  if (!value) return emptyCompanionState();
  return normalizeCompanionState(value);
}

function chunkKey(index) {
  return `${COMPANION_SYNC_CHUNK_PREFIX}${String(index).padStart(3, "0")}`;
}

function bytesBase64(bytes) {
  let source = "";
  for (const value of bytes) source += String.fromCharCode(value);
  return btoa(source);
}

function base64Bytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Browser-sync chunk is not valid base64");
  }
  const source = atob(value);
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) bytes[index] = source.charCodeAt(index);
  return bytes;
}

function concatBytes(parts, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== total) throw new Error("Browser-sync byte count does not match its metadata");
  return output;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function syncMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Browser-sync metadata must be an object");
  }
  const allowed = new Set(["protocol", "chunks", "bytes", "sha256"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Browser-sync metadata contains unsupported field ${key}`);
  }
  if (value.protocol !== COMPANION_STORAGE_SYNC_PROTOCOL) {
    throw new Error(`Browser-sync metadata protocol must be ${COMPANION_STORAGE_SYNC_PROTOCOL}`);
  }
  if (!Number.isSafeInteger(value.chunks) || value.chunks < 1 || value.chunks > 32) {
    throw new Error("Browser-sync chunk count is invalid");
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_SYNC_BYTES) {
    throw new Error("Browser-sync byte count is invalid");
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new Error("Browser-sync digest is invalid");
  }
  return Object.freeze({
    protocol: COMPANION_STORAGE_SYNC_PROTOCOL,
    chunks: value.chunks,
    bytes: value.bytes,
    sha256: value.sha256,
  });
}

function statesEqual(left, right) {
  return JSON.stringify(normalizeCompanionState(left)) === JSON.stringify(normalizeCompanionState(right));
}

export async function encodeCompanionSyncState(stateValue) {
  const state = normalizeCompanionState(stateValue);
  const bytes = encoder.encode(JSON.stringify(state));
  if (!bytes.byteLength || bytes.byteLength > MAX_SYNC_BYTES) {
    throw new Error(`ChatGPT companion state exceeds the ${MAX_SYNC_BYTES} byte browser-sync limit`);
  }
  const values = {};
  let chunks = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += SYNC_CHUNK_BYTES) {
    values[chunkKey(chunks)] = bytesBase64(bytes.subarray(offset, offset + SYNC_CHUNK_BYTES));
    chunks += 1;
  }
  const meta = Object.freeze({
    protocol: COMPANION_STORAGE_SYNC_PROTOCOL,
    chunks,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
  });
  values[COMPANION_SYNC_META_KEY] = meta;
  return Object.freeze({ meta, values: Object.freeze(values) });
}

export async function readCompanionSyncState(extensionApiValue) {
  const extensionApi = requireApi(extensionApiValue);
  if (!extensionApi.storage.sync) return null;
  const head = await storageGet(extensionApi.storage.sync, [COMPANION_SYNC_META_KEY], extensionApi);
  if (!head[COMPANION_SYNC_META_KEY]) return null;
  const meta = syncMeta(head[COMPANION_SYNC_META_KEY]);
  const keys = Array.from({ length: meta.chunks }, (_, index) => chunkKey(index));
  const stored = await storageGet(extensionApi.storage.sync, keys, extensionApi);
  const parts = keys.map((key) => base64Bytes(stored[key]));
  const bytes = concatBytes(parts, meta.bytes);
  if (await sha256(bytes) !== meta.sha256) throw new Error("Browser-sync companion state failed digest verification");
  let value;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Browser-sync companion state is not valid UTF-8 JSON");
  }
  return normalizeCompanionState(value);
}

export async function writeCompanionSyncState(stateValue, extensionApiValue) {
  const extensionApi = requireApi(extensionApiValue);
  if (!extensionApi.storage.sync) throw new Error("Browser profile sync is unavailable");
  const previous = await storageGet(extensionApi.storage.sync, [COMPANION_SYNC_META_KEY], extensionApi);
  let previousChunks = 0;
  if (previous[COMPANION_SYNC_META_KEY]) {
    try { previousChunks = syncMeta(previous[COMPANION_SYNC_META_KEY]).chunks; }
    catch { previousChunks = 32; }
  }
  const encoded = await encodeCompanionSyncState(stateValue);
  await storageSet(extensionApi.storage.sync, encoded.values, extensionApi);
  const stale = [];
  for (let index = encoded.meta.chunks; index < previousChunks; index += 1) stale.push(chunkKey(index));
  await storageRemove(extensionApi.storage.sync, stale, extensionApi);
  return encoded.meta;
}

export async function loadCompanionState(extensionApiValue) {
  const extensionApi = requireApi(extensionApiValue);
  const local = await storageGet(
    extensionApi.storage.local,
    [COMPANION_STORAGE_KEY, COMPANION_SYNC_ENABLED_KEY],
    extensionApi,
  );
  const syncEnabled = Boolean(local[COMPANION_SYNC_ENABLED_KEY]);
  let state = storedState(local[COMPANION_STORAGE_KEY]);
  if (syncEnabled && extensionApi.storage.sync) {
    const remote = await readCompanionSyncState(extensionApi);
    if (remote && !statesEqual(state, remote)) {
      state = mergeCompanionStates(state, remote);
      await Promise.all([
        storageSet(extensionApi.storage.local, { [COMPANION_STORAGE_KEY]: state }, extensionApi),
        writeCompanionSyncState(state, extensionApi),
      ]);
    }
  }
  return Object.freeze({ state, syncEnabled });
}

export async function saveCompanionState(stateValue, {
  syncEnabled,
  extensionApi: extensionApiValue,
} = {}) {
  const extensionApi = requireApi(extensionApiValue);
  const state = normalizeCompanionState(stateValue);
  const current = await storageGet(extensionApi.storage.local, [COMPANION_SYNC_ENABLED_KEY], extensionApi);
  const enabled = syncEnabled === undefined ? Boolean(current[COMPANION_SYNC_ENABLED_KEY]) : Boolean(syncEnabled);
  await storageSet(extensionApi.storage.local, {
    [COMPANION_STORAGE_KEY]: state,
    [COMPANION_SYNC_ENABLED_KEY]: enabled,
  }, extensionApi);
  if (enabled) await writeCompanionSyncState(state, extensionApi);
  return Object.freeze({ state, syncEnabled: enabled });
}

export async function setCompanionSyncEnabled(enabledValue, extensionApiValue) {
  const extensionApi = requireApi(extensionApiValue);
  const enabled = Boolean(enabledValue);
  const local = await loadCompanionState(extensionApi);
  let state = local.state;
  if (enabled) {
    if (!extensionApi.storage.sync) throw new Error("Browser profile sync is unavailable");
    const remote = await readCompanionSyncState(extensionApi);
    if (remote && !statesEqual(state, remote)) state = mergeCompanionStates(state, remote);
  }
  return saveCompanionState(state, { syncEnabled: enabled, extensionApi });
}

export async function saveBookmark(bookmark, extensionApiValue) {
  const current = await loadCompanionState(extensionApiValue);
  return saveCompanionState(upsertBookmark(current.state, bookmark), {
    syncEnabled: current.syncEnabled,
    extensionApi: extensionApiValue,
  });
}

export async function savePrompt(prompt, extensionApiValue) {
  const current = await loadCompanionState(extensionApiValue);
  return saveCompanionState(upsertPrompt(current.state, prompt), {
    syncEnabled: current.syncEnabled,
    extensionApi: extensionApiValue,
  });
}

export async function deleteBookmark(bookmarkId, extensionApiValue, now = () => new Date()) {
  const current = await loadCompanionState(extensionApiValue);
  const record = current.state.bookmarks.find(({ id }) => id === bookmarkId);
  if (!record) return current;
  return saveCompanionState(upsertBookmark(current.state, tombstoneRecord(record, now)), {
    syncEnabled: current.syncEnabled,
    extensionApi: extensionApiValue,
  });
}

export async function deletePrompt(promptId, extensionApiValue, now = () => new Date()) {
  const current = await loadCompanionState(extensionApiValue);
  const record = current.state.prompts.find(({ id }) => id === promptId);
  if (!record) return current;
  return saveCompanionState(upsertPrompt(current.state, tombstoneRecord(record, now)), {
    syncEnabled: current.syncEnabled,
    extensionApi: extensionApiValue,
  });
}

export async function importCompanionSync(envelope, extensionApiValue) {
  const current = await loadCompanionState(extensionApiValue);
  const state = importSyncEnvelope(envelope, current.state);
  return saveCompanionState(state, {
    syncEnabled: current.syncEnabled,
    extensionApi: extensionApiValue,
  });
}

export function isCompanionStorageState(value) {
  return value?.protocol === COMPANION_STATE_PROTOCOL;
}
