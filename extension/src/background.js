const extensionApi = globalThis.browser ?? globalThis.chrome;
const NATIVE_HOST = "ai.greenways.historia_collect";
const pending = new Map();
let nativePort = null;
let captureQueue = Promise.resolve();

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function storageGet(keys) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.storage.local.get(keys);
  return new Promise((resolve, reject) => {
    extensionApi.storage.local.get(keys, (value) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

async function tabsQuery(query) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.tabs.query(query);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.query(query, (tabs) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs);
    });
  });
}

async function tabMessage(tabId, message) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.tabs.sendMessage(tabId, message);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.sendMessage(tabId, message, (response) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
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

function nativeRequest(op, payload = {}, { timeoutMs = 120_000 } = {}) {
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
        ...payload
      });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

function captureObservation(observation) {
  const next = captureQueue.then(() => nativeRequest("capture", { observation }));
  captureQueue = next.catch(() => {});
  return next;
}

async function captureActiveTab() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)\//.test(tab.url ?? "")) {
    throw new Error("Open a ChatGPT conversation tab before collecting it.");
  }
  const settings = await storageGet(["sourceKey"]);
  const response = await tabMessage(tab.id, {
    type: "historia:collect-observation",
    sourceKey: settings.sourceKey || "browser-default",
    mode: "manual"
  });
  if (!response?.ok) throw new Error(response?.error ?? "The ChatGPT page could not be captured.");
  return captureObservation(response.observation);
}

function handleMessage(request) {
  if (request?.type === "historia:capture-active") return captureActiveTab();
  if (request?.type === "historia:auto-observation") {
    return storageGet(["autoCapture"]).then((settings) => {
      if (!settings.autoCapture) return { skipped: true, reason: "automatic collection is disabled" };
      return captureObservation(request.observation);
    });
  }
  if (request?.type === "historia:native-status") return nativeRequest("status");
  if (request?.type === "historia:native-ping") return nativeRequest("ping", {}, { timeoutMs: 15_000 });
  if (request?.type === "historia:settings-changed") {
    return tabsQuery({ url: ["https://chatgpt.com/*", "https://www.chatgpt.com/*", "https://chat.openai.com/*"] }).then(async (tabs) => {
      await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => tabMessage(tab.id, { type: "historia:configure-auto" })));
      return { ok: true };
    });
  }
  return undefined;
}

extensionApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const operation = handleMessage(request);
  if (!operation) return undefined;
  const promise = Promise.resolve(operation).then((result) => ({ ok: true, result }), (error) => ({ ok: false, error: error.message }));
  if (typeof globalThis.browser !== "undefined") return promise;
  promise.then(sendResponse);
  return true;
});
