import { randomUUID } from "node:crypto";
import { getJson, updateJsonAtomic } from "./storage.js";

const ONLINE_ROOM_CHAT_PREFIX = "app/online-duel/room-chat";
const ROOM_CHAT_LIMIT = 50;

export function roomChatKey(roomId) {
  return `${ONLINE_ROOM_CHAT_PREFIX}/${String(roomId || "")}.json`;
}

export function mergeRoomChatMessages(...collections) {
  const byId = new Map();

  for (const collection of collections) {
    for (const value of Array.isArray(collection) ? collection : []) {
      const text = String(value?.text || "").trim();
      const at = normalizeTimestamp(value?.at);
      if (!text || !at) continue;

      const message = {
        id: String(value?.id || ""),
        playerId: String(value?.playerId || ""),
        name: String(value?.name || "Player"),
        text,
        at,
      };
      const identity = message.id || `${message.playerId}|${message.at}|${message.text}`;
      byId.set(identity, message);
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .slice(-ROOM_CHAT_LIMIT);
}

export async function loadRoomChatMessages(roomId, legacyMessages = []) {
  const payload = await getJson(roomChatKey(roomId));
  return mergeRoomChatMessages(legacyMessages, payload?.messages);
}

export async function appendRoomChatMessage({
  roomId,
  playerId,
  name,
  text,
  at = new Date().toISOString(),
  legacyMessages = [],
}) {
  const message = {
    id: randomUUID(),
    playerId: String(playerId || ""),
    name: String(name || "Player"),
    text: String(text || "").trim(),
    at: normalizeTimestamp(at) || new Date().toISOString(),
  };

  const next = await updateJsonAtomic(roomChatKey(roomId), (current) => ({
    updatedAt: message.at,
    messages: mergeRoomChatMessages(legacyMessages, current?.messages, [message]),
  }));

  return next.messages;
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
