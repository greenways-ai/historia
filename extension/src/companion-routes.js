import { normalizeChatGPTUrl } from "./companion-state.js";

export const COMPANION_DESTINATIONS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  archive: "http://127.0.0.1:4319/#archive",
  import: "http://127.0.0.1:4319/#collect",
  context: "http://127.0.0.1:4319/#context",
  ledger: "http://127.0.0.1:4319/#ledger",
  settings: "http://127.0.0.1:4319/#settings",
});

export function resolveCompanionDestination(value) {
  const destination = COMPANION_DESTINATIONS[String(value)];
  if (!destination) throw new Error(`Unsupported Historia companion destination: ${value}`);
  return destination;
}

export function chatMetadataFromTab(tab) {
  if (!tab || typeof tab !== "object" || !tab.url) return null;
  let url;
  try {
    url = normalizeChatGPTUrl(tab.url);
  } catch {
    return null;
  }
  const title = String(tab.title || "Untitled ChatGPT conversation")
    .replace(/\s*[|·-]\s*ChatGPT\s*$/iu, "")
    .trim()
    .slice(0, 240) || "Untitled ChatGPT conversation";
  return Object.freeze({ url, title });
}
