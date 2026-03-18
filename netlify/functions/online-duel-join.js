import { getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { requireRateLimit } from "./_lib/rate-limit.js";
import { joinOnlineDuel } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  await requireNotBanned(event, "joining online matches");
  await requireRateLimit(event, "online-duel-join", {
    maxRequests: 20,
    windowMs: 10 * 60 * 1000,
    message: "Too many online match attempts from this connection. Try again soon.",
  });

  const body = parseJsonBody(event);
  const origin = getOrigin(event);
  const payload = await joinOnlineDuel({
    origin,
    name: body.name,
    avatar: body.avatar,
    playerId: body.playerId,
    token: body.token,
    roomId: body.roomId,
  });

  return json(200, payload);
});
