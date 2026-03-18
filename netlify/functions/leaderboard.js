import {
  HttpError,
  handleOptions,
  ensureMethod,
  json,
  parseJsonBody,
  withErrorHandling,
} from "./_lib/http.js";
import { normalizeAvatarSelection } from "./_lib/avatar-selection.js";
import {
  getHighScore,
  loadLeaderboardEntries,
  saveLeaderboardEntry,
} from "./_lib/leaderboard.js";
import { requireNotBanned } from "./_lib/bans.js";
import { censorProfanity } from "./_lib/censor.js";
import { getClientIp } from "./_lib/ip.js";
import { requireRateLimit } from "./_lib/rate-limit.js";
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
    }, {
      "Cache-Control": "public, max-age=30, s-maxage=120, stale-while-revalidate=300",
    });
  }

  requireStorage();
  await requireNotBanned(event, "saving leaderboard entries");
  await requireRateLimit(event, "leaderboard-save", {
    maxRequests: 25,
    windowMs: 10 * 60 * 1000,
    message: "Too many leaderboard submissions from this connection. Try again shortly.",
  });

  const body = parseJsonBody(event);
  const name = normalizeName(body.name);
  const score = normalizeScore(body.score);
  const durationMs = normalizeDurationMs(body.durationMs);
  const avatar = normalizeAvatarSelection(body.avatar);
  const result = body.result === "win" ? "win" : "loss";
  const ip = getClientIp(event);

  if (!name) {
    throw new HttpError(400, "Type your name before saving your run.");
  }

  const entries = await saveLeaderboardEntry({
    name,
    avatar,
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
  return censorProfanity(value, { maxLength: 32 });
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
    avatar: entry.avatar,
    score: entry.score,
    durationMs: entry.durationMs,
    result: entry.result,
    playedAt: entry.playedAt,
  };
}
