import { spawn } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  fingerprintExportFiles,
  listExportFiles,
  sha256File,
  stripCommonWrapper,
  validateArchiveEntry
} from "./archive-files.js";

function run(command, args, { input, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`));
        return;
      }
      resolvePromise(result);
    });
    child.stdin.end(input);
  });
}

export async function prepareOpenAIInput(inputPath, limits = {}) {
  const absoluteInput = resolve(inputPath);
  const metadata = await stat(absoluteInput);
  let root;
  let cleanup = async () => {};
  let explicitJson = null;
  let containerSha256 = null;

  if (metadata.isDirectory()) {
    root = absoluteInput;
  } else if (metadata.isFile() && extname(absoluteInput).toLowerCase() === ".zip") {
    const listing = await run("unzip", ["-Z1", absoluteInput]);
    for (const line of listing.stdout.toString("utf8").split(/\r?\n/).filter(Boolean)) validateArchiveEntry(line);
    root = await mkdtemp(join(tmpdir(), "historia-openai-export-"));
    cleanup = () => rm(root, { recursive: true, force: true });
    await run("unzip", ["-qq", absoluteInput, "-d", root]);
    containerSha256 = await sha256File(absoluteInput);
  } else if (metadata.isFile() && extname(absoluteInput).toLowerCase() === ".json") {
    root = dirname(absoluteInput);
    explicitJson = absoluteInput;
  } else {
    throw new Error("ChatGPT export input must be a directory, .zip archive, or JSON file");
  }

  try {
    const listed = await listExportFiles(root, limits);
    let selectedFiles = explicitJson
      ? listed.files.filter((file) => file.absolutePath === explicitJson || ["user.json", "account.json"].includes(basename(file.relativePath).toLowerCase()))
      : stripCommonWrapper(listed.files);
    if (explicitJson && !selectedFiles.some((file) => file.absolutePath === explicitJson)) {
      const explicitMetadata = await stat(explicitJson);
      selectedFiles.push({ absolutePath: explicitJson, relativePath: basename(explicitJson), size: explicitMetadata.size });
      selectedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }
    const fingerprint = await fingerprintExportFiles(selectedFiles);
    return {
      inputPath: absoluteInput,
      root,
      files: selectedFiles,
      totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
      fingerprint,
      containerSha256,
      explicitJson,
      cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
