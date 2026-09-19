import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { loadOnlineWinLeaders } from "./_lib/online-wins.js";
import { storageConfigured } from "./_lib/storage.js";

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

  return json(
    200,
    {
      leaders: (await loadOnlineWinLeaders()).slice(0, 25),
      source: "storage",
    },
    {
      // Keep this near real-time so a point earned mid-game shows up right after
      // you exit. A long cache made the board look like it wasn't updating.
      "Cache-Control": "no-cache, max-age=0, s-maxage=0",
    },
  );
});
