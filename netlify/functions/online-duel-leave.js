import { getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { leaveOnlineDuel } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);

  const body = parseJsonBody(event);
  const payload = await leaveOnlineDuel({
    origin: getOrigin(event),
    playerId: body.playerId,
    token: body.token,
  });

  return json(200, payload);
});
