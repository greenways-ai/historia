import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

function run(command, args, { cwd, env, input, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      };
      if (!allowFailure && result.code !== 0) {
        const message = result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim();
        reject(new Error(`${command} ${args.join(" ")} failed (${result.code}): ${message}`));
        return;
      }
      resolvePromise(result);
    });
    if (input !== undefined && input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function validateRef(ref) {
  if (!/^refs\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..") || ref.endsWith("/") || ref.includes("//")) {
    throw new Error(`invalid Historia ref: ${ref}`);
  }
  return ref;
}

function validateRevision(revision) {
  if (/^[a-f0-9]{40,64}$/i.test(revision)) return revision;
  return validateRef(revision);
}

function validatePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`invalid Git tree path: ${path}`);
  }
  if (/[\0\n\r\t]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`invalid Git tree path: ${path}`);
  }
  return path;
}

function normalizeFiles(files) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files ?? {});
  return entries.map(([path, value]) => {
    validatePath(path);
    if (value === null) return { path, delete: true };
    if (typeof value === "object" && value && !Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) {
      if (value.oid) return { path, oid: value.oid, mode: value.mode ?? "100644" };
      if (value.filePath) return { path, filePath: value.filePath, mode: value.mode ?? "100644" };
      if (Object.hasOwn(value, "content")) return { path, content: value.content, mode: value.mode ?? "100644" };
    }
    return { path, content: value, mode: "100644" };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export class GitVault {
  constructor(repository) {
    this.repository = resolve(repository);
  }

  static async init(repository, { objectFormat = null } = {}) {
    const vault = new GitVault(repository);
    await mkdir(dirname(vault.repository), { recursive: true });
    const check = await run("git", ["--git-dir", vault.repository, "rev-parse", "--git-dir"], { allowFailure: true });
    if (check.code !== 0) {
      const args = ["init", "--bare"];
      if (objectFormat) args.push(`--object-format=${objectFormat}`);
      args.push(vault.repository);
      await run("git", args);
    }
    const bare = (await vault.git(["rev-parse", "--is-bare-repository"])).trim();
    if (bare !== "true") throw new Error(`${vault.repository} is not a bare Git repository`);
    return vault;
  }

  async git(args, options = {}) {
    const result = await run("git", ["--git-dir", this.repository, ...args], options);
    return result.stdout.toString("utf8").trim();
  }

  async objectFormat() {
    return (await this.git(["rev-parse", "--show-object-format"])) || "sha1";
  }

  async zeroOid() {
    return "0".repeat((await this.objectFormat()) === "sha256" ? 64 : 40);
  }

  async resolveRef(ref) {
    validateRef(ref);
    const result = await run("git", ["--git-dir", this.repository, "rev-parse", "--verify", "--quiet", ref], { allowFailure: true });
    return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
  }

  async fileExists(ref, path) {
    validateRef(ref);
    validatePath(path);
    const result = await run("git", ["--git-dir", this.repository, "cat-file", "-e", `${ref}:${path}`], { allowFailure: true });
    return result.code === 0;
  }

  async readText(ref, path) {
    validateRevision(ref);
    validatePath(path);
    const result = await run("git", ["--git-dir", this.repository, "show", `${ref}:${path}`]);
    return result.stdout.toString("utf8");
  }

  async commitForPath(ref, path) {
    validateRef(ref);
    validatePath(path);
    const result = await run("git", ["--git-dir", this.repository, "log", "-1", "--format=%H", ref, "--", path], { allowFailure: true });
    return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
  }

  async writeBlob(content) {
    const input = Buffer.isBuffer(content)
      ? content
      : ArrayBuffer.isView(content)
        ? Buffer.from(content.buffer, content.byteOffset, content.byteLength)
        : Buffer.from(String(content), "utf8");
    const result = await run("git", ["--git-dir", this.repository, "hash-object", "-w", "--stdin"], { input });
    return result.stdout.toString("utf8").trim();
  }

  async writeBlobFromFile(filePath) {
    return this.git(["hash-object", "-w", resolve(filePath)]);
  }

  async commitFiles({
    ref,
    files,
    message,
    expectedOldOid,
    authorName = "Historia Collect",
    authorEmail = "collect@historia.local",
    timestamp = new Date().toISOString()
  }) {
    validateRef(ref);
    const entries = normalizeFiles(files);
    if (!entries.length) throw new Error("a Historia archive transaction must contain at least one path update");
    const oldOid = await this.resolveRef(ref);
    if (expectedOldOid !== undefined && expectedOldOid !== oldOid) {
      throw new Error(`Historia ref changed: expected ${expectedOldOid ?? "missing"}, found ${oldOid ?? "missing"}`);
    }

    const indexedEntries = [];
    const deletedPaths = [];
    for (const entry of entries) {
      if (entry.delete) {
        deletedPaths.push(entry.path);
        continue;
      }
      const oid = entry.oid
        ?? (entry.filePath ? await this.writeBlobFromFile(entry.filePath) : await this.writeBlob(entry.content));
      if (!/^[a-f0-9]{40,64}$/i.test(oid)) throw new Error(`invalid blob oid for ${entry.path}`);
      indexedEntries.push({ ...entry, oid });
    }

    const temporary = await mkdtemp(join(tmpdir(), "historia-index-"));
    const indexPath = join(temporary, "index");
    const indexEnv = { GIT_INDEX_FILE: indexPath };
    try {
      if (oldOid) await this.git(["read-tree", `${oldOid}^{tree}`], { env: indexEnv });
      else await this.git(["read-tree", "--empty"], { env: indexEnv });

      if (indexedEntries.length) {
        const indexInfo = indexedEntries.map((entry) => `${entry.mode} ${entry.oid}\t${entry.path}\n`).join("");
        await this.git(["update-index", "--index-info"], { env: indexEnv, input: indexInfo });
      }
      for (const path of deletedPaths) {
        await this.git(["update-index", "--force-remove", "--", path], { env: indexEnv });
      }

      const treeOid = await this.git(["write-tree"], { env: indexEnv });
      const commitArgs = ["commit-tree", treeOid];
      if (oldOid) commitArgs.push("-p", oldOid);
      const commitEnv = {
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp
      };
      const commitOid = await this.git(commitArgs, { env: commitEnv, input: `${message.trim()}\n` });
      await this.git(["update-ref", ref, commitOid, oldOid ?? await this.zeroOid()]);
      return {
        repository: this.repository,
        ref,
        previousCommitOid: oldOid,
        commitOid,
        treeOid,
        paths: entries.map((entry) => entry.path),
        blobs: Object.fromEntries(indexedEntries.map((entry) => [entry.path, entry.oid]))
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async verify() {
    const result = await run("git", ["--git-dir", this.repository, "fsck", "--full", "--no-reflogs"], { allowFailure: true });
    return {
      ok: result.code === 0,
      stdout: result.stdout.toString("utf8").trim(),
      stderr: result.stderr.toString("utf8").trim()
    };
  }
}
