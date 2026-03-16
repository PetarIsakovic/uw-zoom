import {
  HttpError,
  handleOptions,
  ensureMethod,
  json,
  parseJsonBody,
  withErrorHandling,
} from "./_lib/http.js";
import {
  getHighScore,
  loadLeaderboardEntries,
  saveLeaderboardEntry,
} from "./_lib/leaderboard.js";
import { requireNotBanned } from "./_lib/bans.js";
import { getClientIp } from "./_lib/ip.js";
import { requireStorage, storageConfigured } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET", "POST"]);

  if (event.httpMethod === "GET") {
    const entries = await loadLeaderboardEntries();

    return json(200, {
      entries: entries.map(toPublicEntry),
      highScore: getHighScore(entries),
      source: storageConfigured() ? "storage" : "demo",
    });
  }

  requireStorage();
  await requireNotBanned(event, "saving leaderboard entries");

  const body = parseJsonBody(event);
  const name = normalizeName(body.name);
  const score = normalizeScore(body.score);
  const durationMs = normalizeDurationMs(body.durationMs);
  const result = body.result === "win" ? "win" : "loss";
  const ip = getClientIp(event);

  if (!name) {
    throw new HttpError(400, "Type your name before saving your run.");
  }

  const entries = await saveLeaderboardEntry({
    name,
    score,
    durationMs,
    result,
    ip,
  });

  return json(200, {
    success: true,
    entries: entries.map(toPublicEntry),
    highScore: getHighScore(entries),
  });
});

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toPublicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    score: entry.score,
    durationMs: entry.durationMs,
    result: entry.result,
    playedAt: entry.playedAt,
  };
}
