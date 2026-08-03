import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCollectApp } from "../src/collect/server.js";

const fixture = fileURLToPath(new URL("./fixtures/openai-export/conversations.json", import.meta.url));

function request(app, path, { token, method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("X-Historia-Session", token);
  return app.fetch(new Request(`http://127.0.0.1${path}`, { method, body, headers: requestHeaders }));
}

describe("Historia Collect local application", () => {
  test("protects local APIs with the application session and rejects foreign Host headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-collect-server-"));
    try {
      const app = createCollectApp({
        vaultPath: join(root, "vault.git"),
        databasePath: join(root, "chat.sqlite")
      });
      const sessionResponse = await request(app, "/api/session");
      expect(sessionResponse.status).toBe(200);
      const session = await sessionResponse.json();
      expect(session.session_token).toBe(app.sessionToken);

      expect((await request(app, "/api/status")).status).toBe(403);
      const statusResponse = await request(app, "/api/status", { token: session.session_token });
      expect(statusResponse.status).toBe(200);
      const status = await statusResponse.json();
      expect(status.verification.ok).toBe(true);
      expect(status.index.counts.conversations).toBe(0);

      const foreign = await app.fetch(new Request("http://malicious.example/api/session"));
      expect(foreign.status).toBe(421);
      const crossOriginSession = await request(app, "/api/session", {
        headers: { Origin: "https://malicious.example", "Sec-Fetch-Site": "cross-site" }
      });
      expect(crossOriginSession.status).toBe(403);
      expect(() => createCollectApp({
        vaultPath: join(root, "remote-vault.git"),
        databasePath: join(root, "remote-chat.sqlite"),
        hostname: "0.0.0.0"
      })).toThrow("must bind");
      const crossOriginMutation = await request(app, "/api/index", {
        token: session.session_token,
        method: "POST",
        body: JSON.stringify({ rebuild: true }),
        headers: { "Content-Type": "application/json", Origin: "https://malicious.example" }
      });
      expect(crossOriginMutation.status).toBe(403);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("imports an uploaded ChatGPT JSON export, indexes it, and remains idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "historia-collect-import-"));
    try {
      const app = createCollectApp({
        vaultPath: join(root, "vault.git"),
        databasePath: join(root, "chat.sqlite")
      });
      const session = await (await request(app, "/api/session")).json();
      const bytes = await Bun.file(fixture).arrayBuffer();

      async function upload() {
        const file = new File([bytes], "conversations.json", { type: "application/json" });
        const response = await request(app, "/api/import-openai?filename=conversations.json&include_raw=true", {
          token: session.session_token,
          method: "PUT",
          body: file,
          headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }
        });
        expect(response.status).toBe(200);
        return response.json();
      }

      const first = await upload();
      expect(first.import.idempotent).toBe(false);
      expect(first.index.counts.conversations).toBe(1);
      expect(first.index.counts.message_identities).toBe(4);

      const second = await upload();
      expect(second.import.idempotent).toBe(true);
      expect(second.import.commit_oid).toBe(first.import.commit_oid);

      const [conversationsResponse, sourcesResponse, ledgerResponse] = await Promise.all([
        request(app, "/api/conversations", { token: session.session_token }),
        request(app, "/api/sources", { token: session.session_token }),
        request(app, "/api/ledger", { token: session.session_token })
      ]);
      const conversations = await conversationsResponse.json();
      const sources = await sourcesResponse.json();
      const ledger = await ledgerResponse.json();
      expect(conversations.conversations).toHaveLength(1);
      expect(sources.sources).toHaveLength(1);
      expect(ledger.commits).toHaveLength(1);
      expect(ledger.imports).toHaveLength(1);

      const staticResponse = await request(app, "/");
      expect(staticResponse.status).toBe(200);
      expect(await staticResponse.text()).toContain("Historia Collect");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
