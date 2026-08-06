import {
  createBookmark,
  createPrompt,
  createSyncEnvelope,
  visibleBookmarks,
  visiblePrompts,
} from "./companion-state.js";
import {
  deleteBookmark,
  deletePrompt,
  importCompanionSync,
  loadCompanionState,
  saveBookmark,
  savePrompt,
  setCompanionSyncEnabled,
} from "./companion-storage.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const model = { state: null, syncEnabled: false, activeChat: null };
const toastElement = document.querySelector("[data-toast]");
let toastTimer = null;

function sendMessage(message) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.runtime.sendMessage(message);
  return new Promise((resolve, reject) => {
    extensionApi.runtime.sendMessage(message, (response) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function toast(message, tone = "good") {
  clearTimeout(toastTimer);
  toastElement.hidden = false;
  toastElement.dataset.tone = tone;
  toastElement.textContent = message;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, 4200);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function openDestination(destination) {
  const response = await sendMessage({ type: "historia:open-destination", destination });
  if (!response?.ok) throw new Error(response?.error || "Could not open destination");
}

function recordElement(record, kind) {
  const article = document.createElement("article");
  article.className = "record";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = record.title;
  const timestamp = document.createElement("time");
  timestamp.dateTime = record.updatedAt;
  timestamp.textContent = new Date(record.updatedAt).toLocaleDateString();
  header.append(title, timestamp);
  article.append(header);

  if (kind === "bookmark") {
    const url = document.createElement("code");
    url.textContent = record.url;
    article.append(url);
  } else {
    const preview = document.createElement("p");
    preview.textContent = record.text.length > 240 ? `${record.text.slice(0, 240)}…` : record.text;
    article.append(preview);
  }
  if (record.tags.length) {
    const tags = document.createElement("p");
    tags.textContent = record.tags.map((tag) => `#${tag}`).join(" ");
    article.append(tags);
  }

  const actions = document.createElement("div");
  actions.className = "record-actions";
  if (kind === "bookmark") {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open chat";
    open.addEventListener("click", () => extensionApi.tabs.create({ url: record.url }));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy link";
    copy.addEventListener("click", () => copyText(record.url).then(() => toast("Chat link copied.")));
    actions.append(open, copy);
  } else {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy prompt";
    copy.addEventListener("click", () => copyText(record.text).then(() => toast("Prompt copied. Review it before sending.")));
    const handoff = document.createElement("button");
    handoff.type = "button";
    handoff.textContent = "Copy & open ChatGPT";
    handoff.addEventListener("click", async () => {
      await copyText(record.text);
      await openDestination("chatgpt");
      toast("Prompt copied. Paste and review it in ChatGPT.");
    });
    actions.append(copy, handoff);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.danger = "true";
  remove.textContent = "Remove";
  remove.addEventListener("click", async () => {
    const result = kind === "bookmark"
      ? await deleteBookmark(record.id, extensionApi)
      : await deletePrompt(record.id, extensionApi);
    model.state = result.state;
    model.syncEnabled = result.syncEnabled;
    render();
  });
  actions.append(remove);
  article.append(actions);
  return article;
}

function renderCurrentChat() {
  const container = document.querySelector("[data-current-chat]");
  const saveButton = document.querySelector("[data-save-current]");
  container.replaceChildren();
  if (!model.activeChat) {
    const strong = document.createElement("strong");
    strong.textContent = "No supported ChatGPT conversation is active.";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Open a conversation or shared link, then refresh this card.";
    container.append(strong, paragraph);
    saveButton.disabled = true;
    return;
  }
  const strong = document.createElement("strong");
  strong.textContent = model.activeChat.title;
  const code = document.createElement("code");
  code.textContent = model.activeChat.url;
  container.append(strong, code);
  saveButton.disabled = false;
}

function render() {
  const bookmarks = visibleBookmarks(model.state);
  const prompts = visiblePrompts(model.state);
  document.querySelector("[data-bookmark-count]").textContent = String(bookmarks.length);
  document.querySelector("[data-prompt-count]").textContent = String(prompts.length);
  document.querySelector("[data-sync-summary]").textContent = model.syncEnabled ? "On" : "Off";
  document.querySelector("[data-sync-toggle]").checked = model.syncEnabled;
  renderCurrentChat();

  const filter = document.querySelector("[data-bookmark-filter]").value.trim().toLowerCase();
  const bookmarkRoot = document.querySelector("[data-bookmarks]");
  bookmarkRoot.replaceChildren();
  const shown = bookmarks.filter((entry) => !filter || `${entry.title} ${entry.url} ${entry.tags.join(" ")}`.toLowerCase().includes(filter));
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = bookmarks.length ? "No bookmarks match this filter." : "No chat bookmarks yet.";
    bookmarkRoot.append(empty);
  } else {
    for (const bookmark of shown) bookmarkRoot.append(recordElement(bookmark, "bookmark"));
  }

  const promptRoot = document.querySelector("[data-prompts]");
  promptRoot.replaceChildren();
  if (!prompts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Save a prompt or context handoff to reuse it deliberately.";
    promptRoot.append(empty);
  } else {
    for (const prompt of prompts) promptRoot.append(recordElement(prompt, "prompt"));
  }
}

async function refreshActiveChat() {
  const response = await sendMessage({ type: "historia:active-chat" });
  if (!response?.ok) throw new Error(response?.error || "Could not inspect active tab metadata");
  model.activeChat = response.result || null;
  renderCurrentChat();
}

async function refreshNativeStatus() {
  const element = document.querySelector("[data-native-status]");
  try {
    const response = await sendMessage({ type: "historia:native-status" });
    if (!response?.ok) throw new Error(response?.error || "Native host unavailable");
    element.textContent = response.result?.verification?.ok === false ? "Local archive warning" : "Local archive ready";
  } catch {
    element.textContent = "Local archive not connected";
  }
}

for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click", () => openDestination(button.dataset.open).catch((error) => toast(error.message, "error")));
}

document.querySelector("[data-refresh-current]").addEventListener("click", () => refreshActiveChat().catch((error) => toast(error.message, "error")));
document.querySelector("[data-save-current]").addEventListener("click", async () => {
  if (!model.activeChat) return;
  try {
    const result = await saveBookmark(createBookmark(model.activeChat), extensionApi);
    model.state = result.state;
    model.syncEnabled = result.syncEnabled;
    render();
    toast("Chat bookmark saved. No message content was read.");
  } catch (error) {
    toast(error.message, "error");
  }
});

document.querySelector("[data-bookmark-filter]").addEventListener("input", render);
document.querySelector("[data-prompt-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const tags = String(form.get("tags") || "").split(",").map((value) => value.trim()).filter(Boolean);
  try {
    const result = await savePrompt(createPrompt({
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      tags,
    }), extensionApi);
    model.state = result.state;
    model.syncEnabled = result.syncEnabled;
    event.currentTarget.reset();
    render();
    toast("Prompt saved locally.");
  } catch (error) {
    toast(error.message, "error");
  }
});
document.querySelector("[data-clear-prompt]").addEventListener("click", () => document.querySelector("[data-prompt-form]").reset());

document.querySelector("[data-sync-toggle]").addEventListener("change", async (event) => {
  try {
    const result = await setCompanionSyncEnabled(event.currentTarget.checked, extensionApi);
    model.state = result.state;
    model.syncEnabled = result.syncEnabled;
    render();
    toast(result.syncEnabled
      ? "Browser sync enabled for bookmarks and prompt templates only."
      : "Browser metadata sync disabled.");
  } catch (error) {
    event.currentTarget.checked = model.syncEnabled;
    toast(error.message, "error");
  }
});

document.querySelector("[data-export-sync]").addEventListener("click", () => {
  const envelope = createSyncEnvelope(model.state);
  const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `historia-chatgpt-sync-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("[data-import-sync]").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    const envelope = JSON.parse(await file.text());
    const result = await importCompanionSync(envelope, extensionApi);
    model.state = result.state;
    model.syncEnabled = result.syncEnabled;
    render();
    toast("Sync bundle merged.");
  } catch (error) {
    toast(error.message, "error");
  }
});

(async () => {
  try {
    const loaded = await loadCompanionState(extensionApi);
    model.state = loaded.state;
    model.syncEnabled = loaded.syncEnabled;
    render();
    await Promise.allSettled([refreshActiveChat(), refreshNativeStatus()]);
  } catch (error) {
    toast(error.message, "error");
  }
})();
