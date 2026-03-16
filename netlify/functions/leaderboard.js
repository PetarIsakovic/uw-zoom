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
      entries,
      highScore: getHighScore(entries),
      source: storageConfigured() ? "storage" : "demo",
    });
  }

  requireStorage();

  const body = parseJsonBody(event);
  const name = normalizeName(body.name);
  const score = normalizeScore(body.score);
  const durationMs = normalizeDurationMs(body.durationMs);
  const result = body.result === "win" ? "win" : "loss";

  if (!name) {
    throw new HttpError(400, "Type your name before saving your run.");
  }

  const entries = await saveLeaderboardEntry({
    name,
    score,
    durationMs,
    result,
  });

  return json(200, {
    success: true,
    entries,
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
