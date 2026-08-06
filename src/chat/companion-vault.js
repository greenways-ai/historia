import { canonicalJson, sha256 } from "./identity.js";
import {
  COMPANION_STATE_PROTOCOL,
  emptyCompanionState,
  mergeCompanionStates,
  normalizeCompanionState,
} from "../../extension/src/companion-state.js";
import { defaultHistoriaVaultPath } from "./paths.js";
import { GitVault } from "../vault/git-writer.js";

export const CHATGPT_COMPANION_VAULT_PROTOCOL = "historia.chatgpt.vault-state/1";
export const CHATGPT_COMPANION_SYNC_RECEIPT_PROTOCOL = "historia.chatgpt.vault-sync-receipt/1";
export const CHATGPT_COMPANION_REF = "refs/historia/companion/chatgpt";
export const CHATGPT_COMPANION_STATE_PATH = "companion/chatgpt/state.json";

const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function closedKeys(value, allowed, label) {
  for (const key of Object.keys(plainObject(value, label))) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
  }
}

function canonicalTime(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function optionalHead(value, label = "Historia companion expected head") {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !OID.test(value)) throw new Error(`${label} is invalid`);
  return value.toLowerCase();
}

function sourceLabel(value) {
  const output = String(value ?? "historia-chatgpt-companion").trim();
  if (!output || Buffer.byteLength(output, "utf8") > 160 || /[\0\r\n]/u.test(output)) {
    throw new Error("Historia companion sync source is invalid");
  }
  return output;
}

function stateRecords(value) {
  const state = normalizeCompanionState(value);
  return JSON.stringify({ bookmarks: state.bookmarks, prompts: state.prompts });
}

function mergeStable(leftValue, rightValue) {
  const left = normalizeCompanionState(leftValue);
  const right = normalizeCompanionState(rightValue);
  if (stateRecords(left) === stateRecords(right)) {
    if (left.revision !== right.revision) return left.revision > right.revision ? left : right;
    return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
  }
  return mergeCompanionStates(left, right);
}

function receiptPath(timestamp, digest) {
  const safeTime = timestamp.replaceAll(":", "-");
  return `companion/chatgpt/receipts/${safeTime}-${digest.slice("sha256:".length, 19)}.json`;
}

export function companionStateDigest(value) {
  return `sha256:${sha256(normalizeCompanionState(value))}`;
}

export function normalizeCompanionVaultEnvelope(value) {
  const input = plainObject(value, "Historia companion vault envelope");
  closedKeys(input, new Set(["$schema", "updated_at", "state_sha256", "state"]), "Historia companion vault envelope");
  if (input.$schema !== CHATGPT_COMPANION_VAULT_PROTOCOL) {
    throw new Error(`Historia companion vault protocol must be ${CHATGPT_COMPANION_VAULT_PROTOCOL}`);
  }
  const state = normalizeCompanionState(input.state);
  const stateSha256 = String(input.state_sha256 ?? "");
  if (!DIGEST.test(stateSha256) || stateSha256 !== companionStateDigest(state)) {
    throw new Error("Historia companion vault state failed digest verification");
  }
  return Object.freeze({
    $schema: CHATGPT_COMPANION_VAULT_PROTOCOL,
    updated_at: canonicalTime(input.updated_at, "Historia companion vault updated_at"),
    state_sha256: stateSha256,
    state,
  });
}

function publicSnapshot({ vault, ref, exists, head, envelope }) {
  const state = envelope?.state ?? emptyCompanionState();
  const stateSha256 = envelope?.state_sha256 ?? companionStateDigest(state);
  return Object.freeze({
    protocol: CHATGPT_COMPANION_VAULT_PROTOCOL,
    vault: vault.repository,
    ref,
    exists,
    head,
    updated_at: envelope?.updated_at ?? null,
    state_sha256: stateSha256,
    counts: Object.freeze({
      bookmarks: state.bookmarks.length,
      prompts: state.prompts.length,
      visible_bookmarks: state.bookmarks.filter((entry) => !entry.deletedAt).length,
      visible_prompts: state.prompts.filter((entry) => !entry.deletedAt).length,
    }),
    state,
  });
}

export function createCompanionVaultStore({
  vaultPath = defaultHistoriaVaultPath(),
  ref = CHATGPT_COMPANION_REF,
  now = () => new Date(),
  vaultFactory = (path) => GitVault.init(path),
} = {}) {
  async function readInternal() {
    const vault = await vaultFactory(vaultPath);
    const head = await vault.resolveRef(ref);
    if (!head) return { vault, ref, exists: false, head: null, envelope: null };
    if (!await vault.fileExists(ref, CHATGPT_COMPANION_STATE_PATH)) {
      throw new Error(`Historia companion ref ${ref} does not contain ${CHATGPT_COMPANION_STATE_PATH}`);
    }
    let value;
    try {
      value = JSON.parse(await vault.readText(head, CHATGPT_COMPANION_STATE_PATH));
    } catch (error) {
      throw new Error(`Historia companion vault state is invalid JSON: ${error.message}`);
    }
    const envelope = normalizeCompanionVaultEnvelope(value);
    return { vault, ref, exists: true, head, envelope };
  }

  async function read() {
    return publicSnapshot(await readInternal());
  }

  async function status() {
    const snapshot = await read();
    const { state: _state, ...summary } = snapshot;
    return Object.freeze(summary);
  }

  async function pull() {
    return read();
  }

  async function push(stateValue, {
    expectedHead,
    source = "historia-chatgpt-companion",
  } = {}) {
    const internal = await readInternal();
    const current = publicSnapshot(internal);
    const expected = expectedHead === undefined ? current.head : optionalHead(expectedHead);
    const conflictMerged = expectedHead !== undefined && expected !== current.head;
    const incoming = normalizeCompanionState(stateValue);
    const state = mergeStable(current.state, incoming);
    const stateSha256 = companionStateDigest(state);
    if (stateSha256 === current.state_sha256) {
      return Object.freeze({
        ...current,
        idempotent: true,
        conflict_merged: conflictMerged,
        expected_head: expected,
      });
    }

    const timestamp = now().toISOString();
    canonicalTime(timestamp, "Historia companion sync timestamp");
    const envelope = Object.freeze({
      $schema: CHATGPT_COMPANION_VAULT_PROTOCOL,
      updated_at: timestamp,
      state_sha256: stateSha256,
      state,
    });
    const receipt = Object.freeze({
      $schema: CHATGPT_COMPANION_SYNC_RECEIPT_PROTOCOL,
      source: sourceLabel(source),
      updated_at: timestamp,
      previous_commit_oid: current.head,
      expected_head: expected,
      conflict_merged: conflictMerged,
      previous_state_sha256: current.state_sha256,
      state_sha256: stateSha256,
      state_protocol: COMPANION_STATE_PROTOCOL,
      counts: {
        bookmarks: state.bookmarks.length,
        prompts: state.prompts.length,
      },
    });
    const files = new Map([
      [CHATGPT_COMPANION_STATE_PATH, canonicalJson(envelope)],
      [receiptPath(timestamp, stateSha256), canonicalJson(receipt)],
    ]);
    const commit = await internal.vault.commitFiles({
      ref,
      files,
      expectedOldOid: current.head,
      message: `historia(chatgpt): sync companion metadata ${stateSha256.slice(7, 19)}`,
      authorName: "Historia for ChatGPT",
      authorEmail: "chatgpt@historia.local",
      timestamp,
    });
    return Object.freeze({
      ...publicSnapshot({
        vault: internal.vault,
        ref,
        exists: true,
        head: commit.commitOid,
        envelope,
      }),
      idempotent: false,
      conflict_merged: conflictMerged,
      expected_head: expected,
      previous_head: current.head,
      receipt_path: receiptPath(timestamp, stateSha256),
    });
  }

  return Object.freeze({ status, pull, push });
}
