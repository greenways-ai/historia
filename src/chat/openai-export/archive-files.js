import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { DEFAULT_MAX_FILE_COUNT, DEFAULT_MAX_TOTAL_BYTES } from "./limits.js";

function normalizeRelativePath(path) {
  return path.split(sep).join("/");
}

export function validateArchiveEntry(path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`unsafe path in ChatGPT export: ${path}`);
  }
  if (normalized.split("/").some((part) => part === "..")) throw new Error(`unsafe path in ChatGPT export: ${path}`);
  return normalized;
}

export async function listExportFiles(root, {
  maxFileCount = DEFAULT_MAX_FILE_COUNT,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES
} = {}) {
  const files = [];
  let totalBytes = 0;

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error(`symbolic links are not accepted in ChatGPT exports: ${absolutePath}`);
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) continue;
      const relativePath = normalizeRelativePath(relative(root, absolutePath));
      validateArchiveEntry(relativePath);
      totalBytes += metadata.size;
      files.push({ absolutePath, relativePath, size: metadata.size });
      if (files.length > maxFileCount) throw new Error(`ChatGPT export exceeds ${maxFileCount} files`);
      if (totalBytes > maxTotalBytes) throw new Error(`ChatGPT export exceeds ${maxTotalBytes} bytes`);
    }
  }

  await visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files, totalBytes };
}

export async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return digest.digest("hex");
}

export function stripCommonWrapper(files) {
  if (files.length < 2) return files;
  const parts = files.map((file) => file.relativePath.split("/"));
  const first = parts[0][0];
  if (!first || parts.some((segments) => segments.length < 2 || segments[0] !== first)) return files;
  return files.map((file) => ({ ...file, relativePath: file.relativePath.slice(first.length + 1) }));
}

export async function fingerprintExportFiles(files) {
  const digest = createHash("sha256");
  const manifest = [];
  for (const file of files) {
    const fileSha256 = await sha256File(file.absolutePath);
    digest.update(file.relativePath, "utf8");
    digest.update("\0");
    digest.update(String(file.size), "utf8");
    digest.update("\0");
    digest.update(fileSha256, "ascii");
    digest.update("\n");
    manifest.push({ path: file.relativePath, byte_count: file.size, sha256: fileSha256 });
  }
  return { sha256: digest.digest("hex"), files: manifest };
}
