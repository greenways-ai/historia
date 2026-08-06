import { loadCompanionState, setCompanionSyncEnabled } from "./companion-storage.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#settings");
const syncEnabled = document.querySelector("#syncEnabled");
const status = document.querySelector("#status");

async function load() {
  const value = await loadCompanionState(extensionApi);
  syncEnabled.checked = value.syncEnabled;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await setCompanionSyncEnabled(syncEnabled.checked, extensionApi);
    syncEnabled.checked = result.syncEnabled;
    status.textContent = result.syncEnabled ? "Metadata sync enabled" : "Metadata sync disabled";
  } catch (error) {
    status.textContent = error.message;
  }
  setTimeout(() => { status.textContent = ""; }, 2400);
});

load().catch((error) => { status.textContent = error.message; });
