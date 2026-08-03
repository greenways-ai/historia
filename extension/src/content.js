const extensionApi = globalThis.browser ?? globalThis.chrome;
const CAPTURE_DEBOUNCE_MS = 2500;
let autoCaptureTimer = null;
let autoCaptureObserver = null;

function bytesHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  return bytesHex(await crypto.subtle.digest("SHA-256", bytes));
}

function messageElements() {
  const candidates = [...document.querySelectorAll("main [data-message-author-role], [data-message-author-role]")];
  return candidates.filter((element, index) => {
    if (!(element instanceof HTMLElement)) return false;
    if (candidates.indexOf(element) !== index) return false;
    return !element.parentElement?.closest("[data-message-author-role]");
  });
}

function sanitizedReference(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function codeLanguage(code) {
  const classes = [...code.classList];
  const match = classes.find((value) => value.startsWith("language-"));
  return match ? match.slice("language-".length) : null;
}

function extractBlocks(element) {
  const blocks = [];
  for (const code of element.querySelectorAll("pre code")) {
    const text = code.textContent ?? "";
    if (text.trim()) blocks.push({ type: "code", language: codeLanguage(code), text });
  }

  const clone = element.cloneNode(true);
  for (const removable of clone.querySelectorAll("pre, script, style, button, svg, [aria-hidden='true']")) removable.remove();
  const text = clone.innerText || clone.textContent || "";
  if (text.trim()) blocks.unshift({ type: "text", text: text.trim() });

  for (const image of element.querySelectorAll("img")) {
    blocks.push({
      type: "image",
      asset_pointer: null,
      metadata: {
        alt: image.getAttribute("alt") || null,
        width: image.naturalWidth || image.width || null,
        height: image.naturalHeight || image.height || null
      }
    });
  }
  for (const link of element.querySelectorAll("a[href]")) {
    const href = sanitizedReference(link.getAttribute("href"));
    const label = (link.textContent ?? "").trim();
    if (href && label) blocks.push({ type: "citation", text: label, data: { url: href } });
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function providerMessageId(element) {
  return element.getAttribute("data-message-id")
    || element.closest("[data-message-id]")?.getAttribute("data-message-id")
    || element.parentElement?.closest("[data-message-id]")?.getAttribute("data-message-id")
    || (element.id || null);
}

function messageTimestamp(element) {
  const value = element.querySelector("time[datetime]")?.getAttribute("datetime")
    || element.closest("article")?.querySelector("time[datetime]")?.getAttribute("datetime");
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

async function extractMessages() {
  const elements = messageElements();
  const messages = [];
  for (const [index, element] of elements.entries()) {
    const role = element.getAttribute("data-message-author-role") || "unknown";
    const blocks = extractBlocks(element);
    const fallbackMaterial = `${location.origin}${location.pathname}\0${index}\0${role}`;
    const id = providerMessageId(element) || `visible-${index}-${(await sha256(fallbackMaterial)).slice(0, 24)}`;
    messages.push({
      id,
      role,
      author: { kind: role, display_name: null },
      model: element.getAttribute("data-message-model-slug") || null,
      created_at: messageTimestamp(element),
      updated_at: null,
      blocks,
      parents: index ? [messages[index - 1].id] : [],
      attachments: [],
      state: {
        rendered: true,
        visible_order: index
      }
    });
  }
  return messages;
}

async function conversationIdentity() {
  const match = location.pathname.match(/^\/(?:c|share)\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  return `page-${(await sha256(`${location.origin}${location.pathname}`)).slice(0, 32)}`;
}

function conversationTitle() {
  const title = String(document.title || "Untitled conversation")
    .replace(/\s*[|·-]\s*ChatGPT\s*$/i, "")
    .trim();
  return title || "Untitled conversation";
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

async function sendRuntimeMessage(message) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.runtime.sendMessage(message);
  return new Promise((resolve, reject) => {
    extensionApi.runtime.sendMessage(message, (value) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

async function captureObservation({ sourceKey, mode = "manual" } = {}) {
  const messages = await extractMessages();
  if (!messages.length) throw new Error("No rendered ChatGPT messages were found on this page.");
  const observedAt = new Date().toISOString();
  return {
    $schema: "historia.collect.browser-observation/v1",
    provider: "openai",
    source_key: sourceKey || "browser-default",
    observed_at: observedAt,
    collector: {
      name: "historia-collect-extension",
      version: extensionApi.runtime.getManifest().version,
      mode
    },
    conversation: {
      id: await conversationIdentity(),
      title: conversationTitle(),
      url: `${location.origin}${location.pathname}`,
      created_at: messages.find((message) => message.created_at)?.created_at ?? null,
      updated_at: null
    },
    messages,
    active_path: messages.map((message) => message.id)
  };
}

function stopAutoCapture() {
  if (autoCaptureTimer) clearTimeout(autoCaptureTimer);
  autoCaptureTimer = null;
  autoCaptureObserver?.disconnect();
  autoCaptureObserver = null;
}

async function scheduleAutoCapture() {
  if (autoCaptureTimer) clearTimeout(autoCaptureTimer);
  autoCaptureTimer = setTimeout(async () => {
    autoCaptureTimer = null;
    try {
      const settings = await storageGet(["sourceKey", "autoCapture"]);
      if (!settings.autoCapture) return;
      const observation = await captureObservation({ sourceKey: settings.sourceKey, mode: "automatic" });
      await sendRuntimeMessage({ type: "historia:auto-observation", observation });
    } catch (error) {
      console.debug("Historia automatic capture skipped:", error.message);
    }
  }, CAPTURE_DEBOUNCE_MS);
}

async function configureAutoCapture() {
  const settings = await storageGet(["autoCapture"]);
  stopAutoCapture();
  if (!settings.autoCapture) return;
  autoCaptureObserver = new MutationObserver(() => scheduleAutoCapture());
  autoCaptureObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleAutoCapture();
}

extensionApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "historia:collect-observation" && request?.type !== "historia:configure-auto") return undefined;
  const operation = request.type === "historia:configure-auto"
    ? configureAutoCapture().then(() => ({ ok: true }))
    : captureObservation({ sourceKey: request.sourceKey, mode: request.mode ?? "manual" }).then((observation) => ({ ok: true, observation }));
  if (typeof globalThis.browser !== "undefined") return operation;
  operation.then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

configureAutoCapture().catch((error) => console.debug("Historia auto-capture setup failed:", error.message));
