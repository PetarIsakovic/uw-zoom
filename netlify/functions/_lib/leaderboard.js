import { createHash, randomUUID } from "node:crypto";
import { getJson, putJson, storageConfigured } from "./storage.js";

const LEADERBOARD_KEY = "app/leaderboard/top-streaks.json";
const LEADERBOARD_MAX_ENTRIES = 10;

export async function loadLeaderboardEntries() {
  if (!storageConfigured()) {
    return [];
  }

  const payload = await getJson(LEADERBOARD_KEY);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];

  return entries.filter(isValidEntry).map(normalizeEntry).sort(compareLeaderboardEntries);
}

export async function saveLeaderboardEntry(payload) {
  const entries = await loadLeaderboardEntries();
  entries.push(
    normalizeEntry({
      ...payload,
      id: randomUUID(),
      playedAt: new Date().toISOString(),
    }),
  );

  entries.sort(compareLeaderboardEntries);

  const trimmedEntries = entries.slice(0, LEADERBOARD_MAX_ENTRIES);

  await putJson(LEADERBOARD_KEY, {
    updatedAt: new Date().toISOString(),
    entries: trimmedEntries,
  });

  return trimmedEntries;
}

export function getHighScore(entries) {
  return normalizeScore(entries[0]?.score);
}

export function compareLeaderboardEntries(left, right) {
  const scoreDifference = normalizeScore(right.score) - normalizeScore(left.score);

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  const durationDifference = normalizeDurationMs(left.durationMs) - normalizeDurationMs(right.durationMs);

  if (durationDifference !== 0) {
    return durationDifference;
  }

  return new Date(right.playedAt || 0).getTime() - new Date(left.playedAt || 0).getTime();
}

export function normalizeEntry(value) {
  return {
    id: normalizeEntryId(value),
    name: normalizeName(value?.name),
    score: normalizeScore(value?.score),
    durationMs: normalizeDurationMs(value?.durationMs, 0),
    result: value?.result === "win" ? "win" : "loss",
    playedAt: normalizeTimestamp(value?.playedAt),
  };
}

export async function deleteLeaderboardEntry(entryId) {
  if (!storageConfigured()) {
    return [];
  }

  const normalizedId = normalizeExplicitId(entryId);
  const entries = await loadLeaderboardEntries();
  const nextEntries = entries.filter((entry) => entry.id !== normalizedId);

  await putJson(LEADERBOARD_KEY, {
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  });

  return nextEntries;
}

function isValidEntry(value) {
  return value && Number.isFinite(Number(value.score));
}

function normalizeName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);

  return normalized || "Anonymous";
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeDurationMs(value, fallback = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeEntryId(value) {
  const explicitId = normalizeExplicitId(value?.id);

  if (explicitId) {
    return explicitId;
  }

  const signature = JSON.stringify({
    name: normalizeName(value?.name),
    score: normalizeScore(value?.score),
    durationMs: normalizeDurationMs(value?.durationMs, 0),
    result: value?.result === "win" ? "win" : "loss",
    playedAt: normalizeTimestamp(value?.playedAt),
  });

  return createHash("sha256").update(signature).digest("hex").slice(0, 24);
}

function normalizeExplicitId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(normalized) ? normalized : "";
}
