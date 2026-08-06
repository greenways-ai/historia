import { createBookmark } from "./companion-state.js";
import { saveBookmark } from "./companion-storage.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const current = document.querySelector("[data-current]");
const save = document.querySelector("[data-save]");
const status = document.querySelector("#status");
let activeChat = null;

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

function createTab(url) {
  if (typeof globalThis.browser !== "undefined") return extensionApi.tabs.create({ url });
  return new Promise((resolve, reject) => {
    extensionApi.tabs.create({ url }, (tab) => {
      const error = extensionApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

async function openDestination(destination) {
  const response = await sendMessage({ type: "historia:open-destination", destination });
  if (!response?.ok) throw new Error(response?.error || "Could not open destination");
  window.close();
}

function renderCurrent() {
  current.replaceChildren();
  const strong = document.createElement("strong");
  const detail = document.createElement("span");
  if (activeChat) {
    strong.textContent = activeChat.title;
    detail.textContent = activeChat.url;
    save.disabled = false;
  } else {
    strong.textContent = "No supported ChatGPT conversation is active.";
    detail.textContent = "Open /c/<id> or /share/<id>, then reopen this menu.";
    save.disabled = true;
  }
  current.append(strong, detail);
}

async function loadActive() {
  const response = await sendMessage({ type: "historia:active-chat" });
  if (!response?.ok) throw new Error(response?.error || "Could not inspect active tab metadata");
  activeChat = response.result || null;
  renderCurrent();
}

save.addEventListener("click", async () => {
  if (!activeChat) return;
  save.disabled = true;
  status.textContent = "Saving bookmark…";
  try {
    await saveBookmark(createBookmark(activeChat), extensionApi);
    status.textContent = "Saved locally. No message content was read.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});

document.querySelector("[data-companion]").addEventListener("click", () => {
  createTab(extensionApi.runtime.getURL("src/companion.html")).then(() => window.close(), (error) => { status.textContent = error.message; });
});
document.querySelector("[data-chatgpt]").addEventListener("click", () => openDestination("chatgpt").catch((error) => { status.textContent = error.message; }));
document.querySelector("[data-archive]").addEventListener("click", () => openDestination("archive").catch((error) => { status.textContent = error.message; }));

loadActive().catch((error) => {
  status.textContent = error.message;
  activeChat = null;
  renderCurrent();
});
