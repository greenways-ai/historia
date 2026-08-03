import { historiaId, sha256 } from "../identity.js";
import { normalizeOpenAIContent, openAITimestamp } from "./content.js";

function mappingEntries(rawConversation) {
  if (Array.isArray(rawConversation.mapping)) {
    return rawConversation.mapping.map((node, index) => [String(node?.id ?? index), node]);
  }
  return Object.entries(rawConversation.mapping ?? {});
}

export function openAIConversationProviderId(rawConversation) {
  return String(rawConversation.conversation_id ?? rawConversation.id ?? rawConversation.uuid ?? sha256(rawConversation).slice(0, 32));
}

export function compareOpenAIUpdateTime(left, right) {
  const leftValue = new Date(openAITimestamp(left.update_time ?? left.updated_at) ?? 0).valueOf();
  const rightValue = new Date(openAITimestamp(right.update_time ?? right.updated_at) ?? 0).valueOf();
  return leftValue - rightValue;
}

export function normalizeOpenAIConversation(rawConversation, { sourceKey }) {
  const providerConversationId = openAIConversationProviderId(rawConversation);
  const hid = historiaId("openai", sourceKey, "conversation", providerConversationId);
  const entries = mappingEntries(rawConversation);
  const nodes = new Map(entries.map(([key, node]) => [String(key), node ?? {}]));
  const messageByNode = new Map();
  const messages = [];

  for (const [nodeId, node] of entries) {
    const rawMessage = node?.message;
    if (!rawMessage) continue;
    const providerMessageId = String(rawMessage.id ?? node.id ?? nodeId);
    const messageHid = historiaId("openai", sourceKey, "message", providerMessageId);
    const metadata = rawMessage.metadata ?? {};
    const normalized = {
      $schema: "historia.chat.message/v1",
      hid: messageHid,
      source: {
        provider: "openai",
        source_kind: "account-export",
        source_key: sourceKey,
        conversation_id: providerConversationId,
        message_id: providerMessageId,
        node_id: String(nodeId)
      },
      role: rawMessage.author?.role ?? "unknown",
      author: {
        kind: rawMessage.author?.role ?? "unknown",
        display_name: rawMessage.author?.name ?? null
      },
      model: metadata.model_slug ?? metadata.default_model_slug ?? null,
      created_at: openAITimestamp(rawMessage.create_time),
      updated_at: openAITimestamp(rawMessage.update_time),
      blocks: normalizeOpenAIContent(rawMessage.content),
      parents: [],
      attachments: Array.isArray(metadata.attachments) ? metadata.attachments : [],
      state: {
        status: rawMessage.status ?? null,
        recipient: rawMessage.recipient ?? null,
        end_turn: rawMessage.end_turn ?? null,
        weight: rawMessage.weight ?? null
      }
    };
    messageByNode.set(String(nodeId), { hid: messageHid, normalized, raw: rawMessage, providerMessageId });
    messages.push({ nodeId: String(nodeId), hid: messageHid, normalized, raw: rawMessage, providerMessageId });
  }

  function nearestMessageAncestor(nodeId) {
    const seen = new Set();
    let current = nodes.get(String(nodeId))?.parent;
    while (current !== null && current !== undefined && !seen.has(String(current))) {
      seen.add(String(current));
      const message = messageByNode.get(String(current));
      if (message) return message;
      current = nodes.get(String(current))?.parent;
    }
    return null;
  }

  const edges = [];
  for (const message of messages) {
    const parent = nearestMessageAncestor(message.nodeId);
    if (!parent) continue;
    message.normalized.parents.push(parent.hid);
    edges.push({ from: parent.hid, to: message.hid, kind: "reply" });
  }

  const activePath = [];
  const seenPath = new Set();
  let cursor = rawConversation.current_node ?? rawConversation.currentNode ?? null;
  while (cursor !== null && cursor !== undefined && !seenPath.has(String(cursor))) {
    seenPath.add(String(cursor));
    const message = messageByNode.get(String(cursor));
    if (message) activePath.push(message.hid);
    cursor = nodes.get(String(cursor))?.parent ?? null;
  }
  activePath.reverse();

  return {
    $schema: "historia.chat.conversation/v1",
    hid,
    source: {
      provider: "openai",
      source_kind: "account-export",
      source_key: sourceKey,
      conversation_id: providerConversationId
    },
    title: rawConversation.title ?? "Untitled conversation",
    created_at: openAITimestamp(rawConversation.create_time),
    updated_at: openAITimestamp(rawConversation.update_time),
    messages,
    edges,
    active_paths: activePath.length ? [activePath] : [],
    provider_state: {
      current_node: rawConversation.current_node ?? null,
      is_archived: rawConversation.is_archived ?? null,
      is_starred: rawConversation.is_starred ?? null
    },
    raw: rawConversation
  };
}
