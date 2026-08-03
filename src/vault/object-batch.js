import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runCatFile(repository, mode, specs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["--git-dir", resolve(repository), "cat-file", mode], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if ((code ?? 1) !== 0) {
        reject(new Error(`git cat-file ${mode} failed (${code ?? 1}): ${errorText}`));
        return;
      }
      resolvePromise(Buffer.concat(stdout));
    });
    child.stdin.end(`${specs.join("\n")}\n`);
  });
}

function validatedSpecs(requestedSpecs) {
  const specs = [...new Set((requestedSpecs ?? []).map(String))];
  for (const spec of specs) {
    if (!spec || /[\0\n\r]/.test(spec)) throw new Error(`invalid Git object spec: ${JSON.stringify(spec)}`);
  }
  return specs;
}

function readLine(buffer, offset) {
  const newline = buffer.indexOf(10, offset);
  if (newline < 0) throw new Error("truncated git cat-file response header");
  return {
    line: buffer.subarray(offset, newline).toString("utf8"),
    nextOffset: newline + 1
  };
}

async function inspectGitObjects(repository, specs) {
  if (!specs.length) return new Map();
  const output = await runCatFile(repository, "--batch-check", specs);
  const lines = output.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length !== specs.length) throw new Error("git cat-file --batch-check returned an unexpected number of records");
  const result = new Map();
  for (const [index, spec] of specs.entries()) {
    const line = lines[index];
    if (line.endsWith(" missing")) {
      result.set(spec, { spec, missing: true, oid: null, type: null, size: 0 });
      continue;
    }
    const match = /^([a-f0-9]{40,64}) ([^ ]+) ([0-9]+)$/i.exec(line);
    if (!match) throw new Error(`unexpected git cat-file check response for ${spec}: ${line}`);
    const [, oid, type, sizeText] = match;
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid git object size for ${spec}: ${sizeText}`);
    result.set(spec, { spec, missing: false, oid, type, size });
  }
  return result;
}

export async function readGitObjects(repository, requestedSpecs) {
  const specs = validatedSpecs(requestedSpecs);
  if (!specs.length) return new Map();

  const output = await runCatFile(repository, "--batch", specs);
  const result = new Map();
  let offset = 0;
  for (const spec of specs) {
    const header = readLine(output, offset);
    offset = header.nextOffset;
    if (header.line.endsWith(" missing")) {
      result.set(spec, { spec, missing: true, oid: null, type: null, size: 0, bytes: null });
      continue;
    }
    const match = /^([a-f0-9]{40,64}) ([^ ]+) ([0-9]+)$/i.exec(header.line);
    if (!match) throw new Error(`unexpected git cat-file response for ${spec}: ${header.line}`);
    const [, oid, type, sizeText] = match;
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > output.length) {
      throw new Error(`invalid git object size for ${spec}: ${sizeText}`);
    }
    const bytes = output.subarray(offset, offset + size);
    offset += size;
    if (output[offset] !== 10) throw new Error(`git cat-file response for ${spec} is missing its record terminator`);
    offset += 1;
    result.set(spec, { spec, missing: false, oid, type, size, bytes });
  }
  return result;
}

export async function readGitJsonObjects(repository, specs) {
  const objects = await readGitObjects(repository, specs);
  const result = new Map();
  for (const [spec, object] of objects) {
    if (object.missing) {
      result.set(spec, object);
      continue;
    }
    if (object.type !== "blob") throw new Error(`${spec} resolved to ${object.type}, not a blob`);
    const text = object.bytes.toString("utf8");
    try {
      result.set(spec, { ...object, text, json: JSON.parse(text) });
    } catch (error) {
      throw new Error(`invalid JSON in ${spec}: ${error.message}`);
    }
  }
  return result;
}

export async function readGitJsonObjectsBatched(repository, requestedSpecs, {
  batchSize = 256,
  maxObjectBytes = 64 * 1024 * 1024,
  maxBatchBytes = 64 * 1024 * 1024
} = {}) {
  const specs = validatedSpecs(requestedSpecs);
  const countLimit = Math.max(1, Math.min(4096, Number(batchSize) || 256));
  const objectLimit = Math.max(1, Number(maxObjectBytes) || 64 * 1024 * 1024);
  const byteLimit = Math.max(objectLimit, Number(maxBatchBytes) || 64 * 1024 * 1024);
  const descriptions = await inspectGitObjects(repository, specs);
  const result = new Map();
  const batches = [];
  let current = [];
  let currentBytes = 0;

  for (const spec of specs) {
    const description = descriptions.get(spec);
    if (!description || description.missing) {
      result.set(spec, description ?? { spec, missing: true, oid: null, type: null, size: 0, bytes: null });
      continue;
    }
    if (description.type !== "blob") throw new Error(`${spec} resolved to ${description.type}, not a blob`);
    if (description.size > objectLimit) {
      throw new Error(`Git JSON object ${spec} exceeds the ${objectLimit} byte indexing limit`);
    }
    if (current.length && (current.length >= countLimit || currentBytes + description.size > byteLimit)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(spec);
    currentBytes += description.size;
  }
  if (current.length) batches.push(current);

  for (const batchSpecs of batches) {
    const batch = await readGitJsonObjects(repository, batchSpecs);
    for (const [spec, object] of batch) result.set(spec, object);
  }
  return result;
}
