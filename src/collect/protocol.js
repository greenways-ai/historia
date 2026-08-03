export const NATIVE_PROTOCOL_VERSION = "1.0";
export const DEFAULT_MAX_NATIVE_REQUEST_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_NATIVE_RESPONSE_BYTES = 1024 * 1024;

export async function* decodeNativeMessages(readable, { maxBytes = DEFAULT_MAX_NATIVE_REQUEST_BYTES } = {}) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of readable) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = buffer.length ? Buffer.concat([buffer, incoming]) : incoming;
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > maxBytes) throw new Error(`native message exceeds limit: ${length} > ${maxBytes}`);
      if (buffer.length < 4 + length) break;
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      let message;
      try { message = JSON.parse(payload.toString("utf8")); }
      catch (error) { throw new Error(`invalid native message JSON: ${error.message}`); }
      yield message;
    }
  }
  if (buffer.length) throw new Error("native message stream ended with a partial frame");
}

export function encodeNativeMessage(message, { maxBytes = DEFAULT_MAX_NATIVE_RESPONSE_BYTES } = {}) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > maxBytes) throw new Error(`native response exceeds limit: ${payload.length} > ${maxBytes}`);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export async function writeNativeMessage(writable, message, options = {}) {
  const frame = encodeNativeMessage(message, options);
  if (writable.write(frame)) return;
  await new Promise((resolve, reject) => {
    writable.once("drain", resolve);
    writable.once("error", reject);
  });
}

function requestId(value) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 1024 || /[\0\r\n]/.test(value)) {
    throw new Error("request_id must be a non-empty bounded string");
  }
  return value;
}

export function validateNativeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native request must be an object");
  if (value.protocol_version !== NATIVE_PROTOCOL_VERSION) throw new Error(`unsupported native protocol version: ${value.protocol_version}`);
  const op = typeof value.op === "string" ? value.op : "";
  if (!new Set(["ping", "capture", "status"]).has(op)) throw new Error(`unsupported native operation: ${op || "missing"}`);
  return {
    protocol_version: NATIVE_PROTOCOL_VERSION,
    request_id: requestId(value.request_id),
    op,
    observation: value.observation,
    options: value.options && typeof value.options === "object" && !Array.isArray(value.options) ? value.options : {}
  };
}

export function successResponse(requestIdValue, result) {
  return {
    protocol_version: NATIVE_PROTOCOL_VERSION,
    request_id: requestIdValue,
    ok: true,
    result
  };
}

export function errorResponse(requestIdValue, error, code = "collect_error") {
  return {
    protocol_version: NATIVE_PROTOCOL_VERSION,
    request_id: typeof requestIdValue === "string" && requestIdValue ? requestIdValue : "invalid-request",
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
