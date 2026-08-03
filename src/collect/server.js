import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import collectHtml from "../../apps/collect/index.html" with { type: "text" };
import collectJavaScript from "../../apps/collect/app.js" with { type: "text" };
import collectCss from "../../apps/collect/styles.css" with { type: "text" };
import { archiveOpenAIExport, verifyHistoriaVault } from "../chat/archive.js";
import { buildChatContext, formatChatContextMarkdown } from "../chat/context.js";
import { defaultHistoriaIndexPath, openChatIndex } from "../chat/index-storage.js";
import { indexHistoriaChats } from "../chat/indexer.js";
import { defaultHistoriaVaultPath } from "../chat/paths.js";
import { chatIndexHeads, listChatConversations, loadConversationSnapshot, searchChatIndex } from "../chat/search.js";

const VERSION = "0.1.0";
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...headers
    }
  });
}

function errorJson(error, status = 400) {
  return json({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }, status);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function booleanValue(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  return new Set(["1", "true", "yes", "on"]).has(String(value).toLowerCase());
}

function normalizedHostname(value) {
  const hostname = String(value ?? "").trim().toLowerCase();
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function assertLoopbackHost(value) {
  const hostname = normalizedHostname(value);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
    throw new Error("Historia Collect must bind to 127.0.0.1, localhost, or ::1");
  }
  return hostname;
}

function allowedRequestHost(url, configuredHost) {
  const hostname = normalizedHostname(url.hostname);
  const configured = normalizedHostname(configuredHost);
  return LOOPBACK_HOSTS.has(hostname) && new Set([configured, "127.0.0.1", "localhost", "::1"]).has(hostname);
}

function safeSessionBootstrap(request, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "none" || fetchSite === "same-origin";
}

function sameOriginMutation(request, url) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
}

async function readJsonBody(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BODY_BYTES) throw new Error("JSON request body exceeds 2 MiB");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BODY_BYTES) throw new Error("JSON request body exceeds 2 MiB");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (error) { throw new Error(`invalid JSON request: ${error.message}`); }
}

async function copyRequestBody(request, destination) {
  if (!request.body) throw new Error("archive upload is required");
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES) throw new Error("archive upload exceeds 20 GiB");
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) callback(new Error("archive upload exceeds 20 GiB"));
      else callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(request.body), limiter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  if (received <= 0) throw new Error("archive upload is empty");
  return received;
}

function uploadedExtension(name) {
  const extension = extname(String(name ?? "")).toLowerCase();
  if (!new Set([".zip", ".json"]).has(extension)) throw new Error("upload must be a ChatGPT .zip or .json export");
  return extension;
}

export function createCollectApp({
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath),
  assets = { html: collectHtml, javascript: collectJavaScript, css: collectCss },
  hostname = "127.0.0.1",
  sessionToken = randomBytes(32).toString("hex")
} = {}) {
  hostname = assertLoopbackHost(hostname);
  const staticFiles = new Map([
    ["/", [assets.html, "text/html; charset=utf-8"]],
    ["/index.html", [assets.html, "text/html; charset=utf-8"]],
    ["/app.js", [assets.javascript, "text/javascript; charset=utf-8"]],
    ["/styles.css", [assets.css, "text/css; charset=utf-8"]]
  ]);

  let indexTail = Promise.resolve();
  let sharedIncrementalIndex = null;

  function enqueueIndex(options = {}) {
    const task = indexTail.then(() => indexHistoriaChats({ vaultPath, databasePath, ...options }));
    indexTail = task.catch(() => {});
    return task;
  }

  function updateIndex(options = {}) {
    if (!options.rebuild && sharedIncrementalIndex) return sharedIncrementalIndex;
    const task = enqueueIndex(options);
    if (options.rebuild) return task;
    const shared = task.finally(() => {
      if (sharedIncrementalIndex === shared) sharedIncrementalIndex = null;
    });
    sharedIncrementalIndex = shared;
    return shared;
  }

  async function withDatabase(operation) {
    await updateIndex();
    const db = await openChatIndex(databasePath);
    try { return await operation(db); }
    finally { db.close(); }
  }

  function authenticated(request) {
    return request.headers.get("x-historia-session") === sessionToken;
  }

  async function api(request, url) {
    if (url.pathname === "/api/session" && request.method === "GET") {
      if (!safeSessionBootstrap(request, url)) return errorJson(new Error("cross-origin session bootstrap rejected"), 403);
      return json({ ok: true, session_token: sessionToken, version: VERSION });
    }
    if (!authenticated(request)) return errorJson(new Error("invalid Historia application session"), 403);

    if (url.pathname === "/api/status" && request.method === "GET") {
      const verification = await verifyHistoriaVault(vaultPath);
      const index = await updateIndex();
      return json({ ok: verification.ok, vault: vaultPath, database: databasePath, verification, index });
    }
    if (url.pathname === "/api/sources" && request.method === "GET") {
      return json(await withDatabase((db) => ({ ok: true, sources: chatIndexHeads(db) })));
    }
    if (url.pathname === "/api/ledger" && request.method === "GET") {
      const limit = boundedNumber(url.searchParams.get("limit"), 200, 1, 2000);
      const sourceRef = url.searchParams.get("source_ref") || null;
      return json(await withDatabase((db) => {
        const conditions = [];
        const parameters = [];
        if (sourceRef) {
          conditions.push("cc.source_ref = ?");
          parameters.push(sourceRef);
        }
        parameters.push(limit);
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const commits = db.query(`
          SELECT cc.source_ref, cc.commit_oid, cc.parent_oid, cc.authored_at, cc.committed_at,
                 cc.message, COUNT(ci.receipt_path) AS import_count
          FROM chat_commits cc
          LEFT JOIN chat_imports ci
            ON ci.source_ref = cc.source_ref AND ci.commit_oid = cc.commit_oid
          ${where}
          GROUP BY cc.source_ref, cc.commit_oid
          ORDER BY COALESCE(cc.committed_at, cc.authored_at, '') DESC, cc.commit_oid DESC
          LIMIT ?
        `).all(...parameters);
        const imports = db.query(`
          SELECT source_ref, commit_oid, receipt_path, provider, source_key, archive_sha256,
                 observed_at, previous_commit_oid
          FROM chat_imports
          ${sourceRef ? "WHERE source_ref = ?" : ""}
          ORDER BY COALESCE(observed_at, '') DESC, commit_oid DESC, receipt_path
          LIMIT ?
        `).all(...(sourceRef ? [sourceRef, limit] : [limit]));
        return { ok: true, commits, imports };
      }));
    }
    if (url.pathname === "/api/index" && request.method === "POST") {
      const body = await readJsonBody(request);
      const index = await updateIndex({ rebuild: Boolean(body.rebuild) });
      return json({ ok: true, index });
    }
    if (url.pathname === "/api/conversations" && request.method === "GET") {
      const limit = boundedNumber(url.searchParams.get("limit"), 200, 1, 1000);
      const sourceRef = url.searchParams.get("source_ref") || null;
      return json(await withDatabase((db) => ({ ok: true, conversations: listChatConversations(db, { limit, sourceRef }) })));
    }
    if (url.pathname === "/api/search" && request.method === "GET") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) throw new Error("search query is required");
      const role = url.searchParams.getAll("role");
      const options = {
        limit: boundedNumber(url.searchParams.get("limit"), 50, 1, 500),
        sourceRef: url.searchParams.get("source_ref") || null,
        role: role.length ? role : null,
        since: url.searchParams.get("since") || null,
        until: url.searchParams.get("until") || null
      };
      return json(await withDatabase((db) => ({ ok: true, query, results: searchChatIndex(db, query, options) })));
    }
    if (url.pathname === "/api/conversation" && request.method === "GET") {
      const hid = url.searchParams.get("hid");
      if (!hid) throw new Error("conversation HID is required");
      const sourceRef = url.searchParams.get("source_ref") || null;
      const commitOid = url.searchParams.get("commit") || null;
      const conversation = await withDatabase((db) => loadConversationSnapshot(db, hid, { sourceRef, commitOid }));
      if (!conversation) return errorJson(new Error("conversation not found"), 404);
      return json({ ok: true, conversation });
    }
    if (url.pathname === "/api/context" && request.method === "POST") {
      const body = await readJsonBody(request);
      const query = String(body.query ?? "").trim();
      if (!query) throw new Error("context query is required");
      const bundle = await withDatabase((db) => buildChatContext(db, query, {
        budget: boundedNumber(body.budget, 12_000, 128, 2_000_000),
        maxConversations: boundedNumber(body.max_conversations, 8, 1, 50),
        radius: boundedNumber(body.radius, 2, 0, 20),
        includeBranches: Boolean(body.include_branches),
        sourceRef: body.source_ref || null,
        role: Array.isArray(body.role) && body.role.length ? body.role : null,
        since: body.since || null,
        until: body.until || null
      }));
      return json({ ok: true, bundle, markdown: formatChatContextMarkdown(bundle) });
    }
    if (url.pathname === "/api/import-openai" && request.method === "PUT") {
      const fileName = url.searchParams.get("filename") || "chatgpt-export.zip";
      const extension = uploadedExtension(fileName);
      const temporary = await mkdtemp(join(tmpdir(), "historia-collect-upload-"));
      const inputPath = join(temporary, `chatgpt-export${extension}`);
      try {
        const receivedBytes = await copyRequestBody(request, inputPath);
        const archived = await archiveOpenAIExport({
          inputPath,
          vaultPath,
          sourceKey: url.searchParams.get("source")?.trim() || undefined,
          ref: url.searchParams.get("ref")?.trim() || undefined,
          includeRawFiles: booleanValue(url.searchParams.get("include_raw"), true)
        });
        const index = await updateIndex();
        return json({
          ok: true,
          import: {
            idempotent: archived.idempotent,
            source_ref: archived.ref,
            commit_oid: archived.commitOid,
            head_commit_oid: archived.headCommitOid ?? archived.commitOid,
            receipt_path: archived.receiptPath,
            received_bytes: receivedBytes,
            stats: archived.receipt?.stats ?? null,
            warnings: archived.receipt?.warnings ?? []
          },
          index
        });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    return errorJson(new Error("API route not found"), 404);
  }

  async function fetchHandler(request) {
    const url = new URL(request.url);
    if (!allowedRequestHost(url, hostname)) return errorJson(new Error("unrecognized Host header"), 421);
    if (!sameOriginMutation(request, url)) return errorJson(new Error("cross-origin mutation rejected"), 403);
    try {
      if (url.pathname.startsWith("/api/")) return await api(request, url);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      const definition = staticFiles.get(url.pathname);
      if (!definition) return new Response("Not found", { status: 404 });
      const [content, contentType] = definition;
      return new Response(request.method === "HEAD" ? null : content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY"
        }
      });
    } catch (error) {
      return errorJson(error, 400);
    }
  }

  return {
    vaultPath,
    databasePath,
    hostname,
    sessionToken,
    fetch: fetchHandler
  };
}

export function startCollectServer({
  hostname = "127.0.0.1",
  port = 4319,
  vaultPath = defaultHistoriaVaultPath(),
  databasePath = defaultHistoriaIndexPath(vaultPath)
} = {}) {
  const app = createCollectApp({ hostname, vaultPath, databasePath });
  const server = Bun.serve({
    hostname: app.hostname,
    port,
    idleTimeout: 255,
    fetch: app.fetch,
    error(error) { return errorJson(error, 500); }
  });
  return { server, app, url: server.url.toString() };
}
