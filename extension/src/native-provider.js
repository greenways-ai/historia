import { mergeCompanionStates } from "./companion-state.js";
import { loadCompanionState, saveCompanionState } from "./companion-storage.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const model = {
  provider: null,
  sync: null,
  context: null,
};
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

async function native(type, payload = {}) {
  const response = await sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error || "Historia native provider request failed");
  return response.result;
}

function toast(message, tone = "good") {
  const element = document.querySelector("[data-toast]");
  if (!element) return;
  clearTimeout(toastTimer);
  element.hidden = false;
  element.dataset.tone = tone;
  element.textContent = message;
  toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
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

async function openChatGPT() {
  const response = await sendMessage({ type: "historia:open-destination", destination: "chatgpt" });
  if (!response?.ok) throw new Error(response?.error || "Could not open ChatGPT");
}

function shortOid(value) {
  return typeof value === "string" && value ? value.slice(0, 12) : "—";
}

function renderProviderStatus() {
  const status = model.provider;
  const sync = model.sync ?? status?.sync ?? null;
  const ready = status?.verification?.ok !== false && Boolean(status);
  const badge = document.querySelector("[data-vault-status]");
  if (badge) badge.textContent = ready ? "Vault ready" : "Vault unavailable";
  const summary = document.querySelector("[data-vault-summary]");
  if (summary) {
    summary.textContent = status
      ? `${status.counts?.conversations ?? 0} conversations · ${status.counts?.message_revisions ?? status.counts?.revisions ?? 0} revisions · ${status.counts?.sources ?? 0} sources`
      : "Connect the Historia native host to search and synchronize the local Git vault.";
  }
  const head = document.querySelector("[data-vault-head]");
  if (head) head.textContent = shortOid(sync?.head);
  const digest = document.querySelector("[data-vault-digest]");
  if (digest) digest.textContent = sync?.state_sha256 ? sync.state_sha256.slice(0, 19) : "—";
  const counts = document.querySelector("[data-vault-metadata-counts]");
  if (counts) counts.textContent = sync
    ? `${sync.counts?.visible_bookmarks ?? 0} bookmarks · ${sync.counts?.visible_prompts ?? 0} prompts`
    : "No vault metadata state yet";
}

async function refreshStatus() {
  const status = await native("historia:history-status");
  model.provider = status;
  model.sync = status.sync ?? await native("historia:history-sync-status");
  renderProviderStatus();
  return status;
}

function searchResultElement(result) {
  const article = document.createElement("article");
  article.className = "record history-result";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = result.title || "Untitled conversation";
  const role = document.createElement("span");
  role.className = "badge";
  role.textContent = result.role || "message";
  header.append(title, role);
  const snippet = document.createElement("p");
  snippet.textContent = result.snippet || result.content_preview || "No preview available.";
  const provenance = document.createElement("code");
  provenance.textContent = `${shortOid(result.provenance?.commit_oid)} · ${result.message_hid || "unknown message"}`;
  const actions = document.createElement("div");
  actions.className = "record-actions";
  const use = document.createElement("button");
  use.type = "button";
  use.textContent = "Use query in context";
  use.addEventListener("click", () => {
    const input = document.querySelector("[data-context-query]");
    input.value = result.title || result.snippet || "";
    input.focus();
    document.querySelector("[data-context-panel]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy preview";
  copy.addEventListener("click", () => copyText(result.content_preview || result.snippet || "").then(() => toast("History preview copied.")));
  actions.append(use, copy);
  article.append(header, snippet, provenance, actions);
  return article;
}

function renderSearchResults(results) {
  const root = document.querySelector("[data-history-results]");
  if (!root) return;
  root.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matching messages were found in the local Historia index.";
    root.append(empty);
    return;
  }
  for (const result of results) root.append(searchResultElement(result));
}

async function searchHistory(form) {
  const data = new FormData(form);
  const result = await native("historia:history-search", {
    query: String(data.get("query") || ""),
    limit: Number(data.get("limit") || 20),
    historical: data.get("historical") === "on",
    expand_topics: data.get("expandTopics") === "on",
  });
  renderSearchResults(result.results ?? []);
  document.querySelector("[data-history-result-count]").textContent = `${result.results?.length ?? 0} results`;
}

async function buildContext(form) {
  const data = new FormData(form);
  const result = await native("historia:context-build", {
    query: String(data.get("query") || ""),
    budget: Number(data.get("budget") || 12000),
    max_conversations: Number(data.get("maxConversations") || 8),
    radius: Number(data.get("radius") || 2),
    include_branches: data.get("includeBranches") === "on",
    expand_topics: data.get("expandTopics") === "on",
    format: "markdown",
  });
  model.context = result.markdown || "";
  const output = document.querySelector("[data-context-output]");
  output.value = model.context;
  const summary = result.summary;
  document.querySelector("[data-context-summary]").textContent = summary
    ? `${summary.matches?.included_messages ?? 0} messages · ${summary.matches?.conversation_snapshots ?? 0} conversations · ~${summary.budget?.estimated_tokens ?? 0} tokens`
    : "Context built.";
}

async function importExport(form) {
  const data = new FormData(form);
  const result = await native("historia:history-import-export", {
    input_path: String(data.get("inputPath") || ""),
    source_key: String(data.get("sourceKey") || "").trim() || undefined,
    include_raw_files: data.get("includeRawFiles") === "on",
  });
  toast(result.idempotent ? "That official export was already archived." : "Official ChatGPT export committed to the Historia vault.");
  await refreshStatus();
}

async function pullMetadata() {
  const remote = await native("historia:history-sync-pull");
  const local = await loadCompanionState(extensionApi);
  const state = mergeCompanionStates(local.state, remote.state);
  await saveCompanionState(state, { syncEnabled: local.syncEnabled, extensionApi });
  model.sync = remote;
  renderProviderStatus();
  toast("Vault metadata merged into the browser projection.");
  setTimeout(() => location.reload(), 650);
}

async function pushMetadata() {
  const local = await loadCompanionState(extensionApi);
  const remote = await native("historia:history-sync-push", {
    state: local.state,
    expected_head: model.sync?.head ?? null,
    source: "historia-chatgpt-extension",
  });
  await saveCompanionState(remote.state, { syncEnabled: local.syncEnabled, extensionApi });
  model.sync = remote;
  renderProviderStatus();
  toast(remote.conflict_merged
    ? "Vault changed on another device; records were merged and committed."
    : remote.idempotent ? "Vault metadata was already current." : "Browser metadata committed to the Historia vault.");
  setTimeout(() => location.reload(), 650);
}

async function syncMetadata() {
  const pulled = await native("historia:history-sync-pull");
  const local = await loadCompanionState(extensionApi);
  const merged = mergeCompanionStates(local.state, pulled.state);
  const pushed = await native("historia:history-sync-push", {
    state: merged,
    expected_head: pulled.head,
    source: "historia-chatgpt-extension",
  });
  await saveCompanionState(pushed.state, { syncEnabled: local.syncEnabled, extensionApi });
  model.sync = pushed;
  renderProviderStatus();
  toast("Browser projection and Git vault synchronized.");
  setTimeout(() => location.reload(), 650);
}

function bind() {
  document.querySelector("[data-history-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    searchHistory(event.currentTarget).catch((error) => toast(error.message, "error"));
  });
  document.querySelector("[data-context-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    buildContext(event.currentTarget).catch((error) => toast(error.message, "error"));
  });
  document.querySelector("[data-context-copy]")?.addEventListener("click", () => {
    if (!model.context) return toast("Build context first.", "error");
    copyText(model.context).then(() => toast("Bounded Historia context copied."), (error) => toast(error.message, "error"));
  });
  document.querySelector("[data-context-open]")?.addEventListener("click", async () => {
    try {
      if (!model.context) throw new Error("Build context first.");
      await copyText(model.context);
      await openChatGPT();
      toast("Context copied. Paste and review it before sending.");
    } catch (error) {
      toast(error.message, "error");
    }
  });
  document.querySelector("[data-native-import-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    importExport(event.currentTarget).catch((error) => toast(error.message, "error"));
  });
  document.querySelector("[data-native-sync-pull]")?.addEventListener("click", () => pullMetadata().catch((error) => toast(error.message, "error")));
  document.querySelector("[data-native-sync-push]")?.addEventListener("click", () => pushMetadata().catch((error) => toast(error.message, "error")));
  document.querySelector("[data-native-sync-now]")?.addEventListener("click", () => syncMetadata().catch((error) => toast(error.message, "error")));
  document.querySelector("[data-vault-refresh]")?.addEventListener("click", () => refreshStatus().catch((error) => toast(error.message, "error")));
}

bind();
refreshStatus().catch((error) => {
  model.provider = null;
  model.sync = null;
  renderProviderStatus();
  console.debug("Historia native provider unavailable:", error.message);
});
