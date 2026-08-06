export const COMPANION_STATE_PROTOCOL = "historia.chatgpt.companion-state/1";
export const CHAT_BOOKMARK_PROTOCOL = "historia.chatgpt.bookmark/1";
export const PROMPT_TEMPLATE_PROTOCOL = "historia.chatgpt.prompt/1";
export const COMPANION_SYNC_PROTOCOL = "historia.chatgpt.sync/1";

export const MAX_BOOKMARKS = 128;
export const MAX_PROMPTS = 32;
export const MAX_SYNC_BYTES = 90 * 1024;

const RECORD_ID = /^[a-z0-9][a-z0-9._/-]{7,127}$/i;
const CHAT_ID = /^[A-Za-z0-9_-]{6,160}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SECRET_KEY = /^(?:secret|password|token|api[-_]?key|private[-_]?key|authorization|bearer|cookie|session)$/i;
const encoder = new TextEncoder();

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function closedKeys(value, allowed, label) {
  for (const key of Object.keys(plainObject(value, label))) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      throw new Error(`${label} contains unsupported field ${key}`);
    }
    if (SECRET_KEY.test(key)) throw new Error(`${label} cannot contain secret field ${key}`);
  }
}

function text(value, label, maximum, { empty = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const output = value.trim();
  if (!empty && !output) throw new Error(`${label} cannot be empty`);
  if (output.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return output;
}

function id(value, label) {
  const output = text(value, label, 128);
  if (!RECORD_ID.test(output)) throw new Error(`${label} is invalid`);
  return output;
}

function canonicalTime(value, label) {
  const output = text(value, label, 80);
  const parsed = Date.parse(output);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== output) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return output;
}

function optionalTime(value, label) {
  return value === null || value === undefined ? null : canonicalTime(value, label);
}

function stringList(value, label, { maximum = 16, itemMaximum = 64 } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > maximum) throw new Error(`${label} cannot contain more than ${maximum} entries`);
  const items = value.map((entry, index) => text(entry, `${label}[${index}]`, itemMaximum));
  if (new Set(items).size !== items.length) throw new Error(`${label} cannot contain duplicates`);
  return Object.freeze(items.sort((left, right) => left.localeCompare(right)));
}

function updatedRecord(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

function boundedEnvelope(value, label = "ChatGPT companion sync envelope") {
  const encoded = JSON.stringify(value);
  if (encoder.encode(encoded).byteLength > MAX_SYNC_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_SYNC_BYTES} byte metadata-sync limit`);
  }
  return value;
}

export function normalizeChatGPTUrl(value, { allowRoot = false } = {}) {
  const source = text(value, "ChatGPT URL", 2048);
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("ChatGPT URL must be absolute");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("ChatGPT URL must use credential-free HTTPS");
  }
  const hostname = url.hostname.toLowerCase();
  if (!new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]).has(hostname)) {
    throw new Error("URL is not a ChatGPT address");
  }
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  if (path === "/") {
    if (!allowRoot) throw new Error("Open a ChatGPT conversation or shared link first");
    return "https://chatgpt.com/";
  }
  const match = path.match(/^\/(c|share)\/([^/]+)$/u);
  if (!match || !CHAT_ID.test(decodeURIComponent(match[2]))) {
    throw new Error("URL is not a supported ChatGPT conversation or shared link");
  }
  return `https://chatgpt.com/${match[1]}/${encodeURIComponent(decodeURIComponent(match[2]))}`;
}

export function normalizeBookmark(value) {
  const input = plainObject(value, "ChatGPT bookmark");
  closedKeys(input, new Set([
    "protocol", "id", "url", "title", "note", "tags", "createdAt", "updatedAt", "deletedAt",
  ]), "ChatGPT bookmark");
  if (input.protocol !== CHAT_BOOKMARK_PROTOCOL) {
    throw new Error(`ChatGPT bookmark protocol must be ${CHAT_BOOKMARK_PROTOCOL}`);
  }
  const createdAt = canonicalTime(input.createdAt, "ChatGPT bookmark createdAt");
  const updatedAt = canonicalTime(input.updatedAt, "ChatGPT bookmark updatedAt");
  if (updatedAt < createdAt) throw new Error("ChatGPT bookmark updatedAt cannot precede createdAt");
  const deletedAt = optionalTime(input.deletedAt, "ChatGPT bookmark deletedAt");
  if (deletedAt && deletedAt < updatedAt) throw new Error("ChatGPT bookmark deletion cannot precede its update");
  return Object.freeze({
    protocol: CHAT_BOOKMARK_PROTOCOL,
    id: id(input.id, "ChatGPT bookmark id"),
    url: normalizeChatGPTUrl(input.url),
    title: text(input.title, "ChatGPT bookmark title", 240),
    note: text(input.note ?? "", "ChatGPT bookmark note", 2000, { empty: true }),
    tags: stringList(input.tags ?? [], "ChatGPT bookmark tags"),
    createdAt,
    updatedAt,
    deletedAt,
  });
}

export function createBookmark(tab, {
  id: recordId = `bookmark/${crypto.randomUUID()}`,
  now = () => new Date(),
} = {}) {
  const input = plainObject(tab, "Active ChatGPT tab");
  const timestamp = now().toISOString();
  return normalizeBookmark({
    protocol: CHAT_BOOKMARK_PROTOCOL,
    id: recordId,
    url: input.url,
    title: text(input.title || "Untitled ChatGPT conversation", "Active ChatGPT title", 240),
    note: "",
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  });
}

export function normalizePrompt(value) {
  const input = plainObject(value, "ChatGPT prompt template");
  closedKeys(input, new Set([
    "protocol", "id", "title", "text", "tags", "createdAt", "updatedAt", "deletedAt",
  ]), "ChatGPT prompt template");
  if (input.protocol !== PROMPT_TEMPLATE_PROTOCOL) {
    throw new Error(`ChatGPT prompt protocol must be ${PROMPT_TEMPLATE_PROTOCOL}`);
  }
  const createdAt = canonicalTime(input.createdAt, "ChatGPT prompt createdAt");
  const updatedAt = canonicalTime(input.updatedAt, "ChatGPT prompt updatedAt");
  if (updatedAt < createdAt) throw new Error("ChatGPT prompt updatedAt cannot precede createdAt");
  const deletedAt = optionalTime(input.deletedAt, "ChatGPT prompt deletedAt");
  if (deletedAt && deletedAt < updatedAt) throw new Error("ChatGPT prompt deletion cannot precede its update");
  return Object.freeze({
    protocol: PROMPT_TEMPLATE_PROTOCOL,
    id: id(input.id, "ChatGPT prompt id"),
    title: text(input.title, "ChatGPT prompt title", 160),
    text: text(input.text, "ChatGPT prompt text", 64 * 1024),
    tags: stringList(input.tags ?? [], "ChatGPT prompt tags"),
    createdAt,
    updatedAt,
    deletedAt,
  });
}

export function createPrompt(value, {
  id: recordId = `prompt/${crypto.randomUUID()}`,
  now = () => new Date(),
} = {}) {
  const input = plainObject(value, "New ChatGPT prompt");
  const timestamp = now().toISOString();
  return normalizePrompt({
    protocol: PROMPT_TEMPLATE_PROTOCOL,
    id: recordId,
    title: input.title,
    text: input.text,
    tags: input.tags ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  });
}

export function emptyCompanionState() {
  return Object.freeze({
    protocol: COMPANION_STATE_PROTOCOL,
    revision: 1,
    bookmarks: Object.freeze([]),
    prompts: Object.freeze([]),
  });
}

export function normalizeCompanionState(value = emptyCompanionState()) {
  const input = plainObject(value, "ChatGPT companion state");
  closedKeys(input, new Set(["protocol", "revision", "bookmarks", "prompts"]), "ChatGPT companion state");
  if (input.protocol !== COMPANION_STATE_PROTOCOL) {
    throw new Error(`ChatGPT companion state protocol must be ${COMPANION_STATE_PROTOCOL}`);
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("ChatGPT companion revision must be a positive integer");
  }
  if (!Array.isArray(input.bookmarks) || !Array.isArray(input.prompts)) {
    throw new TypeError("ChatGPT companion records must be arrays");
  }
  if (input.bookmarks.length > MAX_BOOKMARKS || input.prompts.length > MAX_PROMPTS) {
    throw new Error("ChatGPT companion state exceeds its record limits");
  }
  const bookmarks = input.bookmarks.map(normalizeBookmark);
  const prompts = input.prompts.map(normalizePrompt);
  if (new Set(bookmarks.map((entry) => entry.id)).size !== bookmarks.length) {
    throw new Error("ChatGPT companion bookmarks contain duplicate ids");
  }
  if (new Set(prompts.map((entry) => entry.id)).size !== prompts.length) {
    throw new Error("ChatGPT companion prompts contain duplicate ids");
  }
  const output = Object.freeze({
    protocol: COMPANION_STATE_PROTOCOL,
    revision: input.revision,
    bookmarks: Object.freeze(bookmarks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    prompts: Object.freeze(prompts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  });
  boundedEnvelope(output, "ChatGPT companion state");
  return output;
}

function mergeRecords(left, right, normalize, maximum) {
  const records = new Map();
  for (const item of [...left, ...right]) {
    const record = normalize(item);
    records.set(record.id, updatedRecord(records.get(record.id), record));
  }
  const values = [...records.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maximum);
  return Object.freeze(values);
}

export function mergeCompanionStates(leftValue, rightValue) {
  const left = normalizeCompanionState(leftValue);
  const right = normalizeCompanionState(rightValue);
  return normalizeCompanionState({
    protocol: COMPANION_STATE_PROTOCOL,
    revision: Math.max(left.revision, right.revision) + 1,
    bookmarks: mergeRecords(left.bookmarks, right.bookmarks, normalizeBookmark, MAX_BOOKMARKS),
    prompts: mergeRecords(left.prompts, right.prompts, normalizePrompt, MAX_PROMPTS),
  });
}

export function upsertBookmark(stateValue, bookmarkValue) {
  const state = normalizeCompanionState(stateValue);
  return mergeCompanionStates(state, {
    protocol: COMPANION_STATE_PROTOCOL,
    revision: state.revision,
    bookmarks: [normalizeBookmark(bookmarkValue)],
    prompts: [],
  });
}

export function upsertPrompt(stateValue, promptValue) {
  const state = normalizeCompanionState(stateValue);
  return mergeCompanionStates(state, {
    protocol: COMPANION_STATE_PROTOCOL,
    revision: state.revision,
    bookmarks: [],
    prompts: [normalizePrompt(promptValue)],
  });
}

export function tombstoneRecord(recordValue, now = () => new Date()) {
  const timestamp = now().toISOString();
  if (recordValue?.protocol === CHAT_BOOKMARK_PROTOCOL) {
    return normalizeBookmark({ ...recordValue, updatedAt: timestamp, deletedAt: timestamp });
  }
  if (recordValue?.protocol === PROMPT_TEMPLATE_PROTOCOL) {
    return normalizePrompt({ ...recordValue, updatedAt: timestamp, deletedAt: timestamp });
  }
  throw new Error("Only ChatGPT companion bookmarks and prompts can be deleted");
}

export function createSyncEnvelope(stateValue, { exportedAt = new Date().toISOString() } = {}) {
  const state = normalizeCompanionState(stateValue);
  return boundedEnvelope(Object.freeze({
    protocol: COMPANION_SYNC_PROTOCOL,
    exportedAt: canonicalTime(exportedAt, "ChatGPT sync exportedAt"),
    state,
  }));
}

export function importSyncEnvelope(value, currentState = emptyCompanionState()) {
  const input = plainObject(value, "ChatGPT sync envelope");
  closedKeys(input, new Set(["protocol", "exportedAt", "state"]), "ChatGPT sync envelope");
  if (input.protocol !== COMPANION_SYNC_PROTOCOL) {
    throw new Error(`ChatGPT sync protocol must be ${COMPANION_SYNC_PROTOCOL}`);
  }
  canonicalTime(input.exportedAt, "ChatGPT sync exportedAt");
  boundedEnvelope(input);
  return mergeCompanionStates(currentState, input.state);
}

export function visibleBookmarks(stateValue) {
  return normalizeCompanionState(stateValue).bookmarks.filter((entry) => !entry.deletedAt);
}

export function visiblePrompts(stateValue) {
  return normalizeCompanionState(stateValue).prompts.filter((entry) => !entry.deletedAt);
}
