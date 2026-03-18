import { HttpError, getOrigin, handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { getOnlineDuelState } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);
  await requireNotBanned(event, "joining online matches");

  const playerId = String(event.queryStringParameters?.playerId || "").trim();
  const token = String(event.queryStringParameters?.token || "").trim();

  if (!playerId || !token) {
    throw new HttpError(400, "Online room status needs both playerId and token.");
  }

  const payload = await getOnlineDuelState({
    origin: getOrigin(event),
    playerId,
    token,
  });

  return json(200, payload);
});
