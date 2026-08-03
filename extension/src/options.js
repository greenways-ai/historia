const extensionApi = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#settings");
const sourceKey = document.querySelector("#sourceKey");
const autoCapture = document.querySelector("#autoCapture");
const status = document.querySelector("#status");

async function load() {
  const values = await extensionApi.storage.local.get(["sourceKey", "autoCapture"]);
  sourceKey.value = values.sourceKey || "browser-default";
  autoCapture.checked = Boolean(values.autoCapture);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = sourceKey.value.trim() || "browser-default";
  await extensionApi.storage.local.set({ sourceKey: key, autoCapture: autoCapture.checked });
  await extensionApi.runtime.sendMessage({ type: "historia:settings-changed" });
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 1800);
});

load().catch((error) => { status.textContent = error.message; });
