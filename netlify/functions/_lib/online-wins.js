import { createHash } from "node:crypto";
import { normalizeAvatarSelection } from "./avatar-selection.js";
import { censorProfanity } from "./censor.js";
import { getJson, putJson, storageConfigured } from "./storage.js";

const ONLINE_WINS_KEY = "app/online-duel/wins.json";

export async function loadOnlineWinLeaders() {
  if (!storageConfigured()) {
    return [];
  }

  const payload = await getJson(ONLINE_WINS_KEY);
  const leaders = Array.isArray(payload?.leaders) ? payload.leaders : [];

  return leaders
    .map(normalizeLeader)
    .filter((entry) => entry.name)
    .sort((left, right) => right.wins - left.wins || left.name.localeCompare(right.name));
}

export async function deleteOnlineWinLeader(entryId) {
  if (!storageConfigured()) {
    return [];
  }

  const normalizedId = normalizeId(entryId);
  const nextLeaders = (await loadOnlineWinLeaders()).filter((entry) => entry.id !== normalizedId);

  await putJson(ONLINE_WINS_KEY, {
    updatedAt: new Date().toISOString(),
    leaders: nextLeaders.map((entry) => ({
      name: entry.name,
      avatar: normalizeAvatarSelection(entry.avatar),
      wins: normalizeWins(entry.wins),
    })),
  });

  return nextLeaders;
}

export function normalizeLeader(value) {
  const name = normalizeName(value?.name);

  return {
    id: createLeaderId(name),
    name,
    avatar: normalizeAvatarSelection(value?.avatar),
    wins: normalizeWins(value?.wins),
  };
}

function normalizeName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function normalizeWins(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function createLeaderId(name) {
  return createHash("sha256").update(String(name || "")).digest("hex").slice(0, 24);
}

function normalizeId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(normalized) ? normalized : "";
}
