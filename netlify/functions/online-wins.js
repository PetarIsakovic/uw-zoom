import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { normalizeAvatarSelection } from "./_lib/avatar-selection.js";
import { censorProfanity } from "./_lib/censor.js";
import { getJson, storageConfigured } from "./_lib/storage.js";

const ONLINE_WINS_KEY = "app/online-duel/wins.json";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);

  if (!storageConfigured()) {
    return json(200, {
      leaders: [],
      source: "demo",
    });
  }

  const payload = await getJson(ONLINE_WINS_KEY);
  const leaders = Array.isArray(payload?.leaders) ? payload.leaders : [];

  return json(
    200,
    {
      leaders: normalizeLeaders(leaders),
      source: "storage",
    },
    {
      "Cache-Control": "public, max-age=60, s-maxage=180, stale-while-revalidate=300",
    },
  );
});

function normalizeLeaders(entries) {
  return entries
    .map((entry) => ({
      name: normalizeName(entry?.name),
      avatar: normalizeAvatarSelection(entry?.avatar),
      wins: normalizeWins(entry?.wins),
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => right.wins - left.wins || left.name.localeCompare(right.name))
    .slice(0, 25);
}

function normalizeName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function normalizeWins(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
