const extensionApi = globalThis.browser ?? globalThis.chrome;
const button = document.querySelector("#capture");
const status = document.querySelector("#status");

document.querySelector("#options").addEventListener("click", (event) => {
  event.preventDefault();
  extensionApi.runtime.openOptionsPage();
});

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Collecting…";
  try {
    const response = await extensionApi.runtime.sendMessage({ type: "historia:capture-active" });
    if (!response?.ok) throw new Error(response?.error ?? "Collection failed");
    const result = response.result;
    status.textContent = result.idempotent
      ? `Already archived\n${result.commit_oid?.slice(0, 12) ?? ""}`
      : `Archived\n${result.commit_oid?.slice(0, 12) ?? ""}`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
