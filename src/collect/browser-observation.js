import { canonicalValue, historiaId, sha256 } from "../chat/identity.js";

const DEFAULT_LIMITS = {
  maxMessages: 5000,
  maxBlocksPerMessage: 128,
  maxParentsPerMessage: 16,
  maxStringBytes: 4 * 1024 * 1024,
  maxObservationBytes: 32 * 1024 * 1024,
  maxUnknownDepth: 8,
  maxUnknownEntries: 10_000
};

const FORBIDDEN_KEYS = new Set([
  "authorization",
  "cookie",
  "cookies",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "localstorage",
  "sessionstorage"
]);

const BLOCK_TYPES = new Set([
  "text",
  "code",
  "image",
  "audio",
  "file",
  "citation",
  "tool-call",
  "tool-result",
  "provider"
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringValue(value, field, { required = false, maxBytes = DEFAULT_LIMITS.maxStringBytes } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.normalize("NFC");
  if (required && !normalized) throw new Error(`${field} must not be empty`);
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) throw new Error(`${field} exceeds its byte limit`);
  if (/\0/.test(normalized)) throw new Error(`${field} contains a NUL byte`);
  return normalized;
}

function timestamp(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${field} is not a valid timestamp`);
  return date.toISOString();
}

function sanitizePageUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(String(value)); }
  catch { throw new Error("conversation.url must be an absolute URL"); }
  if (url.protocol !== "https:") throw new Error("conversation.url must use https");
  const hostname = url.hostname.toLowerCase();
  if (!new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]).has(hostname)) {
    throw new Error(`conversation.url host is not allowed: ${hostname}`);
  }
  return `${url.origin}${url.pathname}`;
}

function sanitizeUnknown(value, state, depth = 0) {
  if (depth > state.limits.maxUnknownDepth) throw new Error("browser observation metadata is too deeply nested");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return stringValue(value, "metadata string", { maxBytes: 256 * 1024 });
  if (Array.isArray(value)) {
    state.entries += value.length;
    if (state.entries > state.limits.maxUnknownEntries) throw new Error("browser observation metadata has too many entries");
    return value.map((item) => sanitizeUnknown(item, state, depth + 1));
  }
  if (isPlainObject(value)) {
    const output = {};
    const entries = Object.entries(value);
    state.entries += entries.length;
    if (state.entries > state.limits.maxUnknownEntries) throw new Error("browser observation metadata has too many entries");
    for (const [key, item] of entries) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_KEYS.has(normalizedKey)) throw new Error(`browser observations must not contain credential field: ${key}`);
      output[stringValue(key, "metadata key", { required: true, maxBytes: 1024 })] = sanitizeUnknown(item, state, depth + 1);
    }
    return output;
  }
  throw new Error(`unsupported metadata value: ${typeof value}`);
}

function normalizeBlock(block, field, state) {
  if (!isPlainObject(block)) throw new Error(`${field} must be an object`);
  const type = stringValue(block.type ?? "provider", `${field}.type`, { required: true, maxBytes: 64 });
  if (!BLOCK_TYPES.has(type)) throw new Error(`${field}.type is unsupported: ${type}`);
  const result = { type };
  if (block.text !== undefined && block.text !== null) result.text = stringValue(block.text, `${field}.text`);
  if (block.language !== undefined && block.language !== null) result.language = stringValue(block.language, `${field}.language`, { maxBytes: 256 });
  if (block.asset_pointer !== undefined && block.asset_pointer !== null) {
    result.asset_pointer = stringValue(block.asset_pointer, `${field}.asset_pointer`, { maxBytes: 16 * 1024 });
  }
  if (block.provider_type !== undefined && block.provider_type !== null) {
    result.provider_type = stringValue(block.provider_type, `${field}.provider_type`, { maxBytes: 256 });
  }
  if (block.data !== undefined) result.data = sanitizeUnknown(block.data, state);
  if (block.metadata !== undefined) result.metadata = sanitizeUnknown(block.metadata, state);
  return result;
}

function detectCycle(messages) {
  const parents = new Map(messages.map((message) => [message.id, message.parents]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`browser observation message graph contains a cycle at ${id}`);
    visiting.add(id);
    for (const parent of parents.get(id) ?? []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const message of messages) visit(message.id);
}

export function validateBrowserObservation(input, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (!isPlainObject(input)) throw new Error("browser observation must be an object");
  const encoded = Buffer.from(JSON.stringify(input));
  if (encoded.length > limits.maxObservationBytes) throw new Error("browser observation exceeds its byte limit");
  if (input.$schema !== "historia.collect.browser-observation/v1") {
    throw new Error("unsupported browser observation schema");
  }
  if (input.provider !== undefined && input.provider !== "openai") throw new Error("browser observation provider must be openai");
  const state = { limits, entries: 0 };
  const sourceKey = stringValue(input.source_key, "source_key", { required: true, maxBytes: 1024 });
  if (!isPlainObject(input.conversation)) throw new Error("conversation must be an object");
  const conversation = {
    id: stringValue(input.conversation.id, "conversation.id", { required: true, maxBytes: 2048 }),
    title: stringValue(input.conversation.title ?? "Untitled conversation", "conversation.title", { required: true, maxBytes: 32 * 1024 }),
    url: sanitizePageUrl(input.conversation.url),
    created_at: timestamp(input.conversation.created_at, "conversation.created_at"),
    updated_at: timestamp(input.conversation.updated_at, "conversation.updated_at")
  };
  if (!Array.isArray(input.messages) || !input.messages.length) throw new Error("messages must be a non-empty array");
  if (input.messages.length > limits.maxMessages) throw new Error("browser observation contains too many messages");

  const seen = new Set();
  const messages = input.messages.map((message, index) => {
    const field = `messages[${index}]`;
    if (!isPlainObject(message)) throw new Error(`${field} must be an object`);
    const id = stringValue(message.id, `${field}.id`, { required: true, maxBytes: 2048 });
    if (seen.has(id)) throw new Error(`duplicate browser message id: ${id}`);
    seen.add(id);
    const role = stringValue(message.role ?? "unknown", `${field}.role`, { required: true, maxBytes: 128 });
    if (!Array.isArray(message.blocks)) throw new Error(`${field}.blocks must be an array`);
    if (message.blocks.length > limits.maxBlocksPerMessage) throw new Error(`${field}.blocks contains too many entries`);
    const parents = message.parents === undefined ? [] : message.parents;
    if (!Array.isArray(parents) || parents.length > limits.maxParentsPerMessage) throw new Error(`${field}.parents is invalid`);
    return {
      id,
      role,
      author: isPlainObject(message.author) ? sanitizeUnknown(message.author, state) : { kind: role, display_name: null },
      model: stringValue(message.model, `${field}.model`, { maxBytes: 1024 }),
      created_at: timestamp(message.created_at, `${field}.created_at`),
      updated_at: timestamp(message.updated_at, `${field}.updated_at`),
      blocks: message.blocks.map((block, blockIndex) => normalizeBlock(block, `${field}.blocks[${blockIndex}]`, state)),
      parents: [...new Set(parents.map((parent, parentIndex) => stringValue(parent, `${field}.parents[${parentIndex}]`, { required: true, maxBytes: 2048 })))],
      attachments: Array.isArray(message.attachments) ? sanitizeUnknown(message.attachments, state) : [],
      state: isPlainObject(message.state) ? sanitizeUnknown(message.state, state) : {}
    };
  });

  for (const message of messages) {
    for (const parent of message.parents) {
      if (!seen.has(parent)) throw new Error(`message ${message.id} references unknown parent ${parent}`);
      if (parent === message.id) throw new Error(`message ${message.id} cannot parent itself`);
    }
  }
  detectCycle(messages);

  const activePathInput = input.active_path ?? messages.map((message) => message.id);
  if (!Array.isArray(activePathInput)) throw new Error("active_path must be an array");
  const activePath = activePathInput.map((id, index) => stringValue(id, `active_path[${index}]`, { required: true, maxBytes: 2048 }));
  if (new Set(activePath).size !== activePath.length) throw new Error("active_path must not contain duplicate messages");
  if (activePath.some((id) => !seen.has(id))) throw new Error("active_path references an unknown message");
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  for (let index = 1; index < activePath.length; index += 1) {
    if (!messagesById.get(activePath[index])?.parents.includes(activePath[index - 1])) {
      throw new Error(`active_path is not connected between ${activePath[index - 1]} and ${activePath[index]}`);
    }
  }

  return {
    $schema: "historia.collect.browser-observation/v1",
    provider: "openai",
    source_key: sourceKey,
    observed_at: timestamp(input.observed_at ?? new Date().toISOString(), "observed_at"),
    collector: isPlainObject(input.collector) ? sanitizeUnknown(input.collector, state) : {},
    conversation,
    messages,
    active_path: activePath
  };
}

export function normalizeBrowserObservation(input, options = {}) {
  const observation = validateBrowserObservation(input, options);
  const sourceKey = observation.source_key;
  const providerConversationId = observation.conversation.id;
  const conversationHid = historiaId("openai", sourceKey, "conversation", providerConversationId);
  const hidByProviderId = new Map(observation.messages.map((message) => [
    message.id,
    historiaId("openai", sourceKey, "message", message.id)
  ]));
  const messages = observation.messages.map((message, index) => {
    const hid = hidByProviderId.get(message.id);
    const parents = message.parents.map((parent) => hidByProviderId.get(parent));
    const author = {
      kind: String(message.author?.kind ?? message.role),
      display_name: message.author?.display_name === undefined ? null : message.author.display_name,
      ...message.author
    };
    return {
      nodeId: message.id,
      hid,
      providerMessageId: message.id,
      raw: message,
      normalized: {
        $schema: "historia.chat.message/v1",
        hid,
        source: {
          provider: "openai",
          source_kind: "browser-observed",
          source_key: sourceKey,
          conversation_id: providerConversationId,
          message_id: message.id,
          node_id: message.id
        },
        role: message.role,
        author,
        model: message.model,
        created_at: message.created_at,
        updated_at: message.updated_at,
        blocks: message.blocks,
        parents,
        attachments: message.attachments,
        state: { ...message.state, browser_order: index }
      }
    };
  });
  const edges = messages.flatMap((message) => message.normalized.parents.map((parent) => ({
    from: parent,
    to: message.hid,
    kind: "reply"
  })));
  const activePath = observation.active_path.map((id) => hidByProviderId.get(id));
  const normalized = {
    $schema: "historia.chat.conversation/v1",
    hid: conversationHid,
    source: {
      provider: "openai",
      source_kind: "browser-observed",
      source_key: sourceKey,
      conversation_id: providerConversationId
    },
    title: observation.conversation.title,
    created_at: observation.conversation.created_at,
    updated_at: observation.conversation.updated_at,
    messages,
    edges,
    active_paths: activePath.length ? [activePath] : [],
    provider_state: {
      page_url: observation.conversation.url,
      capture_kind: "browser-observed",
      collector: observation.collector
    },
    raw: observation
  };
  const fingerprintMaterial = canonicalValue({
    schema: observation.$schema,
    provider: observation.provider,
    source_key: observation.source_key,
    conversation: observation.conversation,
    messages: observation.messages,
    active_path: observation.active_path
  });
  return {
    observation,
    conversation: normalized,
    capture_sha256: sha256(fingerprintMaterial)
  };
}
