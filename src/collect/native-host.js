import { defaultHistoriaIndexPath } from "../chat/index-storage.js";
import { indexHistoriaChats } from "../chat/indexer.js";
import { defaultHistoriaVaultPath } from "../chat/paths.js";
import { archiveBrowserObservation, BROWSER_COLLECTOR_VERSION } from "./archive.js";
import { createHistoriaNativeProvider } from "./native-provider.js";
import {
  decodeNativeMessages,
  errorResponse,
  NATIVE_PROTOCOL_VERSION,
  successResponse,
  validateNativeRequest,
  writeNativeMessage,
} from "./protocol.js";

function normalizeCaller(value) {
  if (!value) return null;
  const caller = String(value).trim();
  if (!caller || Buffer.byteLength(caller, "utf8") > 1024 || /[\0\r\n]/.test(caller)) return null;
  if (caller.includes("://")) return caller.endsWith("/") ? caller : `${caller}/`;
  if (/^[A-Za-z0-9@._{}-]+$/.test(caller)) return caller;
  return null;
}

export function nativeCallerFromArgv(argv = process.argv) {
  const first = argv[2] ?? null;
  const second = argv[3] ?? null;
  const normalizedFirst = normalizeCaller(first);
  if (normalizedFirst?.startsWith("chrome-extension://") || normalizedFirst?.startsWith("moz-extension://")) {
    return normalizedFirst;
  }
  if (second && !String(second).startsWith("--parent-window=")) {
    const normalizedSecond = normalizeCaller(second);
    if (normalizedSecond) return normalizedSecond;
  }
  return normalizedFirst;
}

function configuredCallers(value = process.env.HISTORIA_COLLECT_ALLOWED_ORIGINS) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values.map(normalizeCaller).filter(Boolean);
}

function assertAllowedCaller(caller, allowedCallers) {
  const normalized = normalizeCaller(caller);
  if (allowedCallers.length) {
    if (!normalized || !allowedCallers.includes(normalized)) throw new Error(`native caller is not allowed: ${caller ?? "unknown"}`);
    return normalized;
  }
  if (normalized
      && !normalized.startsWith("chrome-extension://")
      && !normalized.startsWith("moz-extension://")
      && !/^[A-Za-z0-9@._{}-]+$/.test(normalized)) {
    throw new Error(`native caller has an unsupported identity: ${normalized}`);
  }
  return normalized;
}

export function createNativeCollectHandler({
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath),
  caller = null,
  allowedCallers = configuredCallers(),
  provider = createHistoriaNativeProvider({ vaultPath, databasePath }),
} = {}) {
  const verifiedCaller = assertAllowedCaller(caller, configuredCallers(allowedCallers));
  if (!provider || typeof provider.handle !== "function") throw new TypeError("Historia native host requires a provider");
  return async (input) => {
    const request = validateNativeRequest(input);
    if (request.op === "ping") {
      return successResponse(request.request_id, {
        collector: "historia-browser-collect",
        collector_version: BROWSER_COLLECTOR_VERSION,
        protocol_version: NATIVE_PROTOCOL_VERSION,
        provider_protocol: provider.protocol,
        caller: verifiedCaller,
        capabilities: [
          "capture",
          "status",
          "git-vault",
          "sqlite-index",
          ...(provider.operations ?? []),
        ],
      });
    }
    if (request.op === "status") {
      return successResponse(request.request_id, await provider.handle("history/status", request.payload));
    }
    if (request.op !== "capture") {
      return successResponse(request.request_id, await provider.handle(request.op, request.payload));
    }
    const archived = await archiveBrowserObservation({
      observation: request.observation,
      vaultPath,
      ref: request.options.ref ?? null,
    });
    const index = request.options.index === false
      ? null
      : await indexHistoriaChats({ vaultPath, databasePath });
    return successResponse(request.request_id, {
      ok: archived.ok,
      idempotent: archived.idempotent,
      source_ref: archived.ref,
      commit_oid: archived.commitOid,
      head_commit_oid: archived.headCommitOid ?? archived.commitOid,
      previous_commit_oid: archived.previousCommitOid ?? null,
      capture_sha256: archived.captureSha256 ?? archived.receipt?.archive?.sha256 ?? null,
      receipt_path: archived.receiptPath,
      stats: archived.receipt?.stats ?? null,
      index,
    });
  };
}

export async function runNativeCollectHost({
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  caller = nativeCallerFromArgv(),
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath),
  allowedCallers = configuredCallers(),
} = {}) {
  let handler;
  try {
    handler = createNativeCollectHandler({ vaultPath, databasePath, caller, allowedCallers });
  } catch (error) {
    errorOutput.write(`historia-collect-host: ${error.message}\n`);
    throw error;
  }
  for await (const message of decodeNativeMessages(input)) {
    let response;
    try {
      response = await handler(message);
    } catch (error) {
      response = errorResponse(message?.request_id, error);
      errorOutput.write(`historia-collect-host: ${error.message}\n`);
    }
    await writeNativeMessage(output, response);
  }
}
