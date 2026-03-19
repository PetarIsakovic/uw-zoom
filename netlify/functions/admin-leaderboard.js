import { requireAdmin } from "./_lib/admin.js";
import {
  HttpError,
  handleOptions,
  ensureMethod,
  json,
  parseJsonBody,
  withErrorHandling,
} from "./_lib/http.js";
import { deleteLeaderboardEntry, loadLeaderboardEntries } from "./_lib/leaderboard.js";
import { deleteOnlineWinLeader, loadOnlineWinLeaders } from "./_lib/online-wins.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET", "POST"]);
  requireAdmin(event);

  if (event.httpMethod === "GET") {
    return json(200, {
      entries: await loadLeaderboardEntries(),
      onlineWins: await loadOnlineWinLeaders(),
    });
  }

  const body = parseJsonBody(event);
  const id = String(body.id || "").trim().toLowerCase();
  const type = String(body.type || "streak").trim().toLowerCase();

  if (!/^[a-z0-9-]{8,64}$/.test(id)) {
    throw new HttpError(400, "A valid leaderboard entry id is required.");
  }

  if (type === "online-win") {
    const entries = await loadOnlineWinLeaders();

    if (!entries.some((entry) => entry.id === id)) {
      throw new HttpError(404, "That online wins entry no longer exists.");
    }

    const nextEntries = await deleteOnlineWinLeader(id);

    return json(200, {
      success: true,
      id,
      type,
      onlineWins: nextEntries,
    });
  }

  if (type !== "streak") {
    throw new HttpError(400, "A valid leaderboard type is required.");
  }

  const entries = await loadLeaderboardEntries();

  if (!entries.some((entry) => entry.id === id)) {
    throw new HttpError(404, "That leaderboard entry no longer exists.");
  }

  const nextEntries = await deleteLeaderboardEntry(id);

  return json(200, {
    success: true,
    id,
    type,
    entries: nextEntries,
  });
});
