import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export function defaultHistoriaVaultPath() {
  if (process.env.HISTORIA_VAULT) return resolve(process.env.HISTORIA_VAULT);
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Historia", "vault.git");
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Historia", "vault.git");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "historia", "vault.git");
}

export function defaultHistoriaIndexPath(vaultPath = defaultHistoriaVaultPath()) {
  if (process.env.HISTORIA_INDEX) return resolve(process.env.HISTORIA_INDEX);
  return join(dirname(resolve(vaultPath)), "chat-index.sqlite");
}
