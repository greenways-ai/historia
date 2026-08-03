const state = {
  token: null,
  view: "collect",
  status: null,
  sources: [],
  conversations: [],
  ledger: { commits: [], imports: [] },
  selectedConversation: null,
  archiveItems: [],
  archiveMode: "conversations",
  context: null,
  contextMarkdown: "",
  busy: false
};

const viewMeta = {
  collect: ["Collect", "Local archive · private by default"],
  archive: ["Archive", "Searchable conversations · Git remains authoritative"],
  context: ["Context", "Bounded retrieval · explicit provenance"],
  ledger: ["Ledger", "Import transactions · refs, commits and receipts"],
  settings: ["Settings", "Local operation · no remote configured by default"]
};

const root = document.querySelector("#view-root");
const title = document.querySelector("#view-title");
const kicker = document.querySelector("#view-kicker");
const connectionState = document.querySelector("#connection-state");
const vaultShort = document.querySelector("#vault-short");
const vaultPill = document.querySelector("#vault-pill");
const toastRegion = document.querySelector("#toast-region");

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = String(value);
    else if (key === "checked") element.checked = Boolean(value);
    else if (key === "value") element.value = String(value);
    else if (key === "htmlFor") element.htmlFor = String(value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.startsWith("data")) element.dataset[key.slice(4).replace(/^[A-Z]/, (letter) => letter.toLowerCase())] = String(value);
    else if (/^aria[A-Z]/.test(key)) element.setAttribute(`aria-${key.slice(4).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "")}`, String(value));
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function shortOid(value, length = 10) {
  const text = String(value ?? "");
  return text ? `${text.slice(0, length)}${text.length > length ? "…" : ""}` : "—";
}

function formatDate(value, { compact = false } = {}) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat(undefined, compact
    ? { year: "numeric", month: "short", day: "2-digit" }
    : { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }
  ).format(date);
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return `${value} ${Number(value) === 1 ? singular : pluralValue}`;
}

function roleName(role) {
  const normalized = String(role ?? "unknown");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toast(message, { title = "Historia", error = false, duration = 4200 } = {}) {
  const item = node("div", { class: `toast${error ? " is-error" : ""}` },
    node("strong", { text: title }),
    node("span", { text: message })
  );
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), duration);
}

function setConnection(status, label) {
  const dot = connectionState.querySelector(".status-dot");
  dot.className = `status-dot${status === "good" ? " is-good" : status === "bad" ? " is-bad" : ""}`;
  connectionState.querySelector("span:last-child").textContent = label;
  const vaultDot = vaultPill.querySelector(".status-dot");
  vaultDot.className = dot.className;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (state.token) headers.set("X-Historia-Session", state.token);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : { ok: response.ok, text: await response.text() };
  if (!response.ok || payload.ok === false) throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed (${response.status})`);
  return payload;
}

function loading() {
  root.replaceChildren(document.querySelector("#loading-template").content.cloneNode(true));
}

function sourceOptions({ includeAll = true } = {}) {
  const options = [];
  if (includeAll) options.push(node("option", { value: "", text: "All sources" }));
  for (const source of state.sources) {
    const label = `${source.provider} · ${source.source_key}`;
    options.push(node("option", { value: source.source_ref, text: label }));
  }
  return options;
}

async function refreshData({ quiet = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  if (!quiet) setConnection("pending", "Refreshing");
  try {
    const [status, sources, conversations, ledger] = await Promise.all([
      request("/api/status"),
      request("/api/sources"),
      request("/api/conversations?limit=500"),
      request("/api/ledger?limit=500")
    ]);
    state.status = status;
    state.sources = sources.sources ?? [];
    state.conversations = conversations.conversations ?? [];
    state.archiveItems = state.conversations;
    state.archiveMode = "conversations";
    state.ledger = { commits: ledger.commits ?? [], imports: ledger.imports ?? [] };
    const headOid = state.sources[0]?.head_commit_oid ?? null;
    vaultShort.textContent = headOid ? shortOid(headOid, 16) : `${Number(status.index?.counts?.commits ?? 0).toLocaleString()} commits`;
    vaultPill.title = status.vault ?? "Historia vault";
    setConnection(status.verification?.ok ? "good" : "bad", status.verification?.ok ? "Local · verified" : "Vault warning");
    render();
  } catch (error) {
    setConnection("bad", "Connection error");
    if (!quiet) toast(error.message, { title: "Refresh failed", error: true });
    render();
  } finally {
    state.busy = false;
  }
}

function switchView(view, { updateHash = true } = {}) {
  if (!viewMeta[view]) view = "collect";
  state.view = view;
  if (updateHash) history.replaceState(null, "", `#${view}`);
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  render();
  root.focus({ preventScroll: true });
}

function panelHeader(titleText, description, badgeText = null) {
  return node("div", { class: "panel-head" },
    node("div", {}, node("h2", { text: titleText }), description ? node("p", { text: description }) : null),
    badgeText ? node("span", { class: "badge", text: badgeText }) : null
  );
}

function metric(value, label) {
  return node("article", { class: "metric" }, node("b", { text: Number(value ?? 0).toLocaleString() }), node("span", { text: label }));
}

function emptyState(titleText, body) {
  return node("div", { class: "empty-state" }, node("div", {}, node("strong", { text: titleText }), node("p", { text: body })));
}

function sourceCard(source) {
  return node("article", { class: "source-card" },
    node("div", { class: "source-card-top" },
      node("div", {}, node("h3", { text: source.completeness === "browser-observed" || source.source_ref.includes("/openai-browser/") ? "ChatGPT browser" : "ChatGPT export" }), node("p", { text: source.completeness })),
      node("span", { class: "badge", text: "Indexed" })
    ),
    node("div", { class: "source-meta" },
      node("code", { text: source.source_ref, title: source.source_ref }),
      node("code", { text: `head ${shortOid(source.head_commit_oid, 14)}`, title: source.head_commit_oid }),
      node("code", { text: `indexed ${formatDate(source.last_indexed_at)}` })
    )
  );
}

function createImportCard() {
  const fileInput = node("input", { type: "file", accept: ".zip,.json", id: "archive-file" });
  const fileChoice = node("div", { class: "file-choice", text: "No export selected" });
  const dropZone = node("label", { class: "drop-zone", htmlFor: "archive-file" },
    node("div", {}, node("strong", { text: "Choose a ChatGPT export" }), node("span", { text: "ZIP or JSON · processed locally into the Git vault" })),
    fileInput
  );
  const sourceInput = node("input", { class: "input", type: "text", name: "source", placeholder: "Optional stable source key" });
  const rawInput = node("input", { type: "checkbox", name: "include_raw", checked: true });
  const submit = node("button", { class: "button button--primary", type: "submit", text: "Import into Historia" });
  const form = node("form", { class: "import-form" },
    dropZone,
    fileChoice,
    node("div", { class: "field" }, node("label", { htmlFor: "import-source", text: "Source key" }), sourceInput),
    node("label", { class: "checkbox" }, rawInput, node("span", { text: "Retain the exact extracted export files" })),
    submit
  );
  sourceInput.id = "import-source";

  function selectFile(file) {
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileChoice.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB`;
  }
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileChoice.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB` : "No export selected";
  });
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); });
  }
  dropZone.addEventListener("drop", (event) => selectFile(event.dataTransfer?.files?.[0]));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const archive = fileInput.files?.[0];
    if (!archive) return toast("Select a ChatGPT export first.", { title: "Import", error: true });
    submit.disabled = true;
    submit.textContent = "Importing…";
    const parameters = new URLSearchParams({
      filename: archive.name,
      include_raw: rawInput.checked ? "true" : "false"
    });
    if (sourceInput.value.trim()) parameters.set("source", sourceInput.value.trim());
    try {
      const result = await request(`/api/import-openai?${parameters}`, {
        method: "PUT",
        body: archive,
        headers: { "Content-Type": archive.type || "application/octet-stream" }
      });
      const imported = result.import;
      toast(imported.idempotent ? "That export was already present; no duplicate commit was created." : `Archived ${plural(imported.stats?.messages ?? 0, "message")} in commit ${shortOid(imported.commit_oid)}.`, { title: imported.idempotent ? "Already archived" : "Import complete" });
      form.reset();
      rawInput.checked = true;
      fileChoice.textContent = "No export selected";
      await refreshData({ quiet: true });
    } catch (error) {
      toast(error.message, { title: "Import failed", error: true, duration: 7000 });
    } finally {
      submit.disabled = false;
      submit.textContent = "Import into Historia";
    }
  });

  return node("section", { class: "panel import-card", id: "import-card" },
    panelHeader("Import account history", "Backfill the archive from an official ChatGPT export.", "Local only"),
    form
  );
}

function renderCollect() {
  const counts = state.status?.index?.counts ?? {};
  const hero = node("div", { class: "hero-grid" },
    node("section", { class: "hero-panel" },
      node("div", { class: "hero-copy" },
        node("p", { class: "technical-kicker", text: "Git-native conversation memory" }),
        node("h2", { text: "Gather once. Remember everywhere." }),
        node("p", { text: "Historia Collect turns account exports and browser observations into a private, content-addressed archive. Every result can be traced back to an immutable Git object and import transaction." }),
        node("div", { class: "hero-actions" },
          node("button", { class: "button button--primary", type: "button", text: "Import history", onclick: () => document.querySelector("#import-card")?.scrollIntoView({ behavior: "smooth", block: "center" }) }),
          node("button", { class: "button", type: "button", text: "Browse archive", onclick: () => switchView("archive") })
        )
      )
    ),
    createImportCard()
  );
  const metrics = node("section", { class: "metric-grid", ariaLabel: "Archive summary" },
    metric(counts.conversations, "Conversations"),
    metric(counts.message_identities, "Messages"),
    metric(counts.message_revisions, "Revisions"),
    metric(counts.commits, "Archive commits")
  );
  const sources = node("section", { class: "view-stack" },
    node("div", { class: "section-title" }, node("div", {}, node("h2", { text: "Collection sources" }), node("p", { text: "Each account, browser collector, or CLI adapter advances an independent Historia source ref." }))),
    state.sources.length ? node("div", { class: "source-grid" }, state.sources.map(sourceCard)) : emptyState("No sources yet", "Import an account export or connect the browser collector to create the first source ref.")
  );
  root.replaceChildren(node("div", { class: "view-stack" }, hero, metrics, sources));
}

function conversationItem(item, mode) {
  const hid = item.conversation_hid;
  const selected = state.selectedConversation?.conversation_hid === hid && state.selectedConversation?.commit_oid === item.commit_oid;
  const content = mode === "search" ? String(item.content ?? "").slice(0, 130) : `${item.node_count ?? 0} messages · ${formatDate(item.updated_at ?? item.observed_at, { compact: true })}`;
  return node("button", {
    class: `conversation-item${selected ? " is-active" : ""}`,
    type: "button",
    onclick: () => selectConversation(item)
  },
    node("h3", { text: item.title || "Untitled conversation" }),
    node("p", { text: mode === "search" ? `${roleName(item.role)} · ${content}` : content }),
    node("code", { text: mode === "search" ? `commit ${shortOid(item.provenance?.commit_oid)}` : shortOid(item.conversation_hid, 34), title: item.conversation_hid })
  );
}

async function selectConversation(item) {
  const hid = item.conversation_hid;
  const sourceRef = item.provenance?.source_ref ?? item.source_ref;
  const commit = item.provenance?.commit_oid ?? item.commit_oid;
  try {
    const query = new URLSearchParams({ hid });
    if (sourceRef) query.set("source_ref", sourceRef);
    if (commit) query.set("commit", commit);
    const result = await request(`/api/conversation?${query}`);
    state.selectedConversation = result.conversation;
    renderArchive();
  } catch (error) {
    toast(error.message, { title: "Conversation unavailable", error: true });
  }
}

function messageCard(message) {
  const body = message.content_text || message.message?.blocks?.map((block) => block.text ?? `[${block.type}]`).join("\n") || "[No textual content]";
  return node("article", { class: `message-card${message.active ? "" : " is-branch"}`, dataRole: message.role ?? "unknown" },
    node("div", { class: "message-meta" },
      node("strong", { text: roleName(message.role) }),
      message.model ? node("span", { text: message.model }) : null,
      message.created_at ? node("time", { dateTime: message.created_at, text: formatDate(message.created_at) }) : null,
      !message.active ? node("span", { class: "badge", text: "alternate branch" }) : null
    ),
    node("div", { class: "message-body", text: body }),
    node("div", { class: "message-provenance" },
      node("span", { text: `message ${shortOid(message.message_hid, 28)}`, title: message.message_hid }),
      node("span", { text: `revision ${shortOid(message.revision_oid)}`, title: message.revision_oid }),
      message.raw_oid ? node("span", { text: `raw ${shortOid(message.raw_oid)}`, title: message.raw_oid }) : null
    )
  );
}

function conversationDetail() {
  const conversation = state.selectedConversation;
  if (!conversation) return emptyState("Choose a conversation", "Select an archive entry or run a search to inspect its branch-aware message graph and Git provenance.");
  return node("div", {},
    node("div", { class: "detail-head" },
      node("h2", { text: conversation.title || "Untitled conversation" }),
      node("p", { text: `${formatDate(conversation.updated_at ?? conversation.observed_at)} · ${plural(conversation.messages.length, "message")} · commit ${shortOid(conversation.commit_oid)}` })
    ),
    node("div", { class: "message-stream" },
      conversation.messages.map(messageCard),
      node("div", { class: "path-block" },
        node("span", { text: "Archive provenance" }),
        node("code", { text: conversation.source_ref }),
        node("code", { text: conversation.commit_oid }),
        node("code", { text: conversation.manifest_path })
      )
    )
  );
}

function renderArchive() {
  const searchInput = node("input", { class: "input", type: "search", placeholder: "Search every message…", ariaLabel: "Search archived messages" });
  const sourceSelect = node("select", { class: "select", ariaLabel: "Filter by source" }, sourceOptions());
  const roleSelect = node("select", { class: "select", ariaLabel: "Filter by role" },
    node("option", { value: "", text: "All roles" }),
    node("option", { value: "user", text: "User" }),
    node("option", { value: "assistant", text: "Assistant" }),
    node("option", { value: "tool", text: "Tool" })
  );
  const searchButton = node("button", { class: "button button--primary", type: "button", text: "Search" });
  const clearButton = node("button", { class: "button", type: "button", text: "All" });

  async function runSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    searchButton.disabled = true;
    try {
      const parameters = new URLSearchParams({ q: query, limit: "100" });
      if (sourceSelect.value) parameters.set("source_ref", sourceSelect.value);
      if (roleSelect.value) parameters.append("role", roleSelect.value);
      const result = await request(`/api/search?${parameters}`);
      state.archiveItems = result.results ?? [];
      state.archiveMode = "search";
      state.selectedConversation = null;
      renderArchive();
      if (!state.archiveItems.length) toast("No archived messages matched that query.", { title: "Search" });
    } catch (error) {
      toast(error.message, { title: "Search failed", error: true });
    } finally {
      searchButton.disabled = false;
    }
  }
  searchButton.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(); });
  clearButton.addEventListener("click", () => {
    state.archiveItems = sourceSelect.value ? state.conversations.filter((item) => item.source_ref === sourceSelect.value) : state.conversations;
    state.archiveMode = "conversations";
    state.selectedConversation = null;
    renderArchive();
  });
  sourceSelect.addEventListener("change", () => {
    if (state.archiveMode === "conversations") {
      state.archiveItems = sourceSelect.value ? state.conversations.filter((item) => item.source_ref === sourceSelect.value) : state.conversations;
      renderArchive();
    }
  });

  const list = state.archiveItems.length
    ? node("div", { class: "conversation-list" }, state.archiveItems.map((item) => conversationItem(item, state.archiveMode)))
    : emptyState(state.archiveMode === "search" ? "No matches" : "Archive is empty", state.archiveMode === "search" ? "Try a broader phrase or remove a source filter." : "Import ChatGPT history to populate the archive.");

  root.replaceChildren(node("div", { class: "archive-layout" },
    node("aside", { class: "archive-sidebar" },
      node("div", { class: "archive-tools" },
        node("div", { class: "search-row" }, searchInput, searchButton),
        node("div", { class: "filter-row" }, sourceSelect, roleSelect),
        clearButton
      ),
      list
    ),
    node("section", { class: "archive-detail" }, conversationDetail())
  ));
}

function renderContext() {
  const query = node("textarea", { class: "textarea", placeholder: "What should the agent remember?\n\nExample: Hestia rooms, keys, signed versioning and external agent negotiation" });
  const budget = node("input", { type: "range", min: "512", max: "50000", step: "256", value: "12000" });
  const budgetOutput = node("output", { text: "12,000" });
  budget.addEventListener("input", () => { budgetOutput.textContent = Number(budget.value).toLocaleString(); });
  const maxConversations = node("input", { class: "input", type: "number", min: "1", max: "50", value: "8" });
  const radius = node("input", { class: "input", type: "number", min: "0", max: "20", value: "2" });
  const source = node("select", { class: "select" }, sourceOptions());
  const includeBranches = node("input", { type: "checkbox" });
  const buildButton = node("button", { class: "button button--primary", type: "submit", text: "Build context" });
  const preview = node("pre", { text: state.contextMarkdown || "A provenance-rich context bundle will appear here.\n\nNo content leaves the local Historia process until you copy or export it." });
  const stats = node("div", { text: state.context ? `${state.context.matches?.included_messages ?? 0} messages · ${state.context.budget?.estimated_tokens ?? 0} estimated tokens` : "No bundle built" });
  const copyButton = node("button", { class: "button", type: "button", text: "Copy Markdown", disabled: !state.contextMarkdown });
  copyButton.addEventListener("click", async () => {
    if (!state.contextMarkdown) return;
    try { await navigator.clipboard.writeText(state.contextMarkdown); toast("Context Markdown copied to the clipboard.", { title: "Copied" }); }
    catch (error) { toast(error.message, { title: "Copy failed", error: true }); }
  });
  const form = node("form", { class: "panel context-controls" },
    panelHeader("Context builder", "Search, expand, deduplicate and pack archived messages under an explicit token budget.", "Deterministic"),
    node("div", { class: "control-stack" },
      node("div", { class: "field" }, node("label", { text: "Retrieval question" }), query),
      node("div", { class: "field" }, node("label", { text: "Token budget" }), node("div", { class: "range-row" }, budget, budgetOutput)),
      node("div", { class: "field-grid" },
        node("div", { class: "field" }, node("label", { text: "Max conversations" }), maxConversations),
        node("div", { class: "field" }, node("label", { text: "Message radius" }), radius),
        node("div", { class: "field field--wide" }, node("label", { text: "Source" }), source)
      ),
      node("label", { class: "checkbox" }, includeBranches, node("span", { text: "Include nearby alternate branches" })),
      buildButton
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = query.value.trim();
    if (!text) return toast("Describe the context the agent needs.", { title: "Context", error: true });
    buildButton.disabled = true;
    buildButton.textContent = "Building…";
    try {
      const result = await request("/api/context", {
        method: "POST",
        body: JSON.stringify({
          query: text,
          budget: Number(budget.value),
          max_conversations: Number(maxConversations.value),
          radius: Number(radius.value),
          include_branches: includeBranches.checked,
          source_ref: source.value || null
        })
      });
      state.context = result.bundle;
      state.contextMarkdown = result.markdown;
      renderContext();
      toast(`Built ${plural(result.bundle.matches?.included_messages ?? 0, "message")} of context.`, { title: "Context ready" });
    } catch (error) {
      toast(error.message, { title: "Context build failed", error: true });
    } finally {
      buildButton.disabled = false;
      buildButton.textContent = "Build context";
    }
  });

  root.replaceChildren(node("div", { class: "context-layout" },
    form,
    node("section", { class: "panel context-preview" },
      node("div", { class: "context-toolbar" }, stats, copyButton),
      node("div", { class: "context-document" }, preview)
    )
  ));
}

function renderLedger() {
  const rows = state.ledger.commits.map((commit) => node("tr", {},
    node("td", {}, node("code", { text: shortOid(commit.commit_oid, 14), title: commit.commit_oid })),
    node("td", {}, node("code", { text: shortOid(commit.parent_oid, 14), title: commit.parent_oid ?? "root" })),
    node("td", { text: formatDate(commit.committed_at ?? commit.authored_at) }),
    node("td", { class: "commit-message", text: commit.message || "Archive transaction" }),
    node("td", { text: Number(commit.import_count ?? 0).toLocaleString() }),
    node("td", {}, node("code", { text: shortOid(commit.source_ref, 32), title: commit.source_ref }))
  ));
  const table = state.ledger.commits.length ? node("div", { class: "ledger-table-wrap" },
    node("table", { class: "ledger-table" },
      node("thead", {}, node("tr", {}, ["Commit", "Parent", "Committed", "Transaction", "Receipts", "Source ref"].map((label) => node("th", { text: label })))),
      node("tbody", {}, rows)
    )
  ) : emptyState("No archive transactions", "Import or capture a conversation to create the first Historia commit.");
  root.replaceChildren(node("div", { class: "view-stack" },
    node("div", { class: "section-title" },
      node("div", {}, node("h2", { text: "Archive ledger" }), node("p", { text: "One commit represents one atomic collection transaction. Full message bodies remain content-addressed Git blobs." })),
      node("span", { class: "badge", text: `${state.ledger.commits.length} commits` })
    ),
    table,
    node("section", { class: "panel settings-card" },
      node("h2", { text: "Provenance boundary" }),
      node("p", { text: "A Historia commit proves that this vault observed a specific byte sequence and linked it into an archive transaction. It does not, by itself, prove that the provider authored those bytes." })
    )
  ));
}

function renderSettings() {
  const status = state.status;
  const verification = status?.verification;
  const verifyButton = node("button", { class: "button", type: "button", text: "Verify vault" });
  const rebuildButton = node("button", { class: "button button--amber", type: "button", text: "Rebuild index" });
  verifyButton.addEventListener("click", async () => {
    verifyButton.disabled = true;
    try { await refreshData(); toast("Git object and reachability checks completed.", { title: "Vault verified" }); }
    finally { verifyButton.disabled = false; }
  });
  rebuildButton.addEventListener("click", async () => {
    if (!window.confirm("Delete and rebuild the derived SQLite chat index from the Git source refs? The Git archive is not changed.")) return;
    rebuildButton.disabled = true;
    rebuildButton.textContent = "Rebuilding…";
    try {
      const result = await request("/api/index", { method: "POST", body: JSON.stringify({ rebuild: true }) });
      toast(`Rebuilt ${plural(result.index.counts?.message_revisions ?? 0, "message revision")}.`, { title: "Index rebuilt" });
      await refreshData({ quiet: true });
    } catch (error) {
      toast(error.message, { title: "Rebuild failed", error: true });
    } finally {
      rebuildButton.disabled = false;
      rebuildButton.textContent = "Rebuild index";
    }
  });
  root.replaceChildren(node("div", { class: "settings-grid" },
    node("section", { class: "panel settings-card" },
      node("h2", { text: "Local storage" }),
      node("p", { text: "Git is authoritative. The SQLite database is a disposable retrieval projection and can be recreated at any time." }),
      node("div", { class: "path-block" }, node("span", { text: "Bare Git vault" }), node("code", { text: status?.vault ?? "—" })),
      node("div", { class: "path-block" }, node("span", { text: "SQLite index" }), node("code", { text: status?.database ?? "—" })),
      node("div", { class: "hero-actions" }, verifyButton, rebuildButton),
      node("div", { class: "warning-note", text: "A normal delete or hide operation does not erase historical Git objects. A true purge requires ref rewriting, reflog expiry, garbage collection, and equivalent action on every remote or clone." })
    ),
    node("section", { class: "panel settings-card" },
      node("h2", { text: "Trust and privacy" }),
      node("p", { text: "The Collect application listens on the local loopback interface, uses a per-process application session token, sends no telemetry, and configures no remote by default." }),
      node("div", { class: "source-meta" },
        node("code", { text: `Git integrity: ${verification?.ok ? "verified" : "attention required"}` }),
        node("code", { text: `Sources: ${state.sources.length}` }),
        node("code", { text: `Index schema: ${state.status?.index?.database ? "ready" : "not available"}` })
      ),
      node("div", { class: "warning-note", text: "Browser observations are labelled as browser-observed evidence. They are useful and auditable, but are not represented as provider-signed exports." })
    )
  ));
}

function render() {
  const [heading, subheading] = viewMeta[state.view] ?? viewMeta.collect;
  title.textContent = heading;
  kicker.textContent = subheading;
  if (!state.status && state.token) {
    loading();
    return;
  }
  if (state.view === "archive") renderArchive();
  else if (state.view === "context") renderContext();
  else if (state.view === "ledger") renderLedger();
  else if (state.view === "settings") renderSettings();
  else renderCollect();
}

async function boot() {
  const storedTheme = localStorage.getItem("historia-theme");
  if (storedTheme === "light" || storedTheme === "dark") document.documentElement.dataset.theme = storedTheme;
  const hashView = location.hash.replace(/^#/, "");
  state.view = viewMeta[hashView] ? hashView : "collect";
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelector("#refresh-button").addEventListener("click", () => refreshData());
  document.querySelector("#theme-button").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("historia-theme", next);
  });
  window.addEventListener("hashchange", () => switchView(location.hash.replace(/^#/, ""), { updateHash: false }));
  switchView(state.view, { updateHash: false });
  loading();
  try {
    const session = await request("/api/session");
    state.token = session.session_token;
    await refreshData();
  } catch (error) {
    setConnection("bad", "Unavailable");
    root.replaceChildren(emptyState("Historia Collect is unavailable", error.message));
  }
}

boot();
