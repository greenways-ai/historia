import { chatMetadataFromTab, resolveCompanionDestination } from "./companion-routes.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const NATIVE_HOST = "ai.greenways.historia_collect";
const pending = new Map();
let nativePort = null;

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function tabsQuery(query) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.tabs.query(query);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.query(query, (tabs) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs);
    });
  });
}

function tabsCreate(createProperties) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.tabs.create(createProperties);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.create(createProperties, (tab) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function rejectPending(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}

function connectNative() {
  if (nativePort) return nativePort;
  nativePort = extensionApi.runtime.connectNative(NATIVE_HOST);
  nativePort.onMessage.addListener((message) => {
    const request = pending.get(message?.request_id);
    if (!request) return;
    pending.delete(message.request_id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error?.message ?? "Historia native host rejected the request"));
  });
  nativePort.onDisconnect.addListener(() => {
    const message = extensionApi.runtime.lastError?.message || "Historia native host disconnected";
    nativePort = null;
    rejectPending(message);
  });
  return nativePort;
}

function nativeRequest(op, payload = {}, { timeoutMs = 30_000 } = {}) {
  const id = requestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Historia native request timed out: ${op}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      connectNative().postMessage({
        protocol_version: "1.0",
        request_id: id,
        op,
        ...payload,
      });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

async function activeChatMetadata() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  return chatMetadataFromTab(tab);
}

function handleMessage(request) {
  if (request?.type === "historia:active-chat") return activeChatMetadata();
  if (request?.type === "historia:open-destination") {
    return tabsCreate({ url: resolveCompanionDestination(request.destination), active: true });
  }
  if (request?.type === "historia:native-status") return nativeRequest("status");
  if (request?.type === "historia:native-ping") return nativeRequest("ping", {}, { timeoutMs: 15_000 });
  return undefined;
}

extensionApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const operation = handleMessage(request);
  if (!operation) return undefined;
  const promise = Promise.resolve(operation).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, error: error.message }),
  );
  if (typeof globalThis.browser !== "undefined") return promise;
  promise.then(sendResponse);
  return true;
});
