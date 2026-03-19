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
      "Cache-Control": "public, max-age=60, s-maxage=180, stale-while-revalidate=300",
    },
  );
});
