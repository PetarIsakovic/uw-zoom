import { getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { requireRateLimit } from "./_lib/rate-limit.js";
import { createPrivateOnlineDuelRoom } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  await requireNotBanned(event, "creating private rooms");
  await requireRateLimit(event, "online-duel-create-room", {
    maxRequests: 12,
    windowMs: 10 * 60 * 1000,
    message: "Too many private room creations from this connection. Try again soon.",
  });

  const body = parseJsonBody(event);
  const payload = await createPrivateOnlineDuelRoom({
    origin: getOrigin(event),
    name: body.name,
    avatar: body.avatar,
    playerId: body.playerId,
    token: body.token,
  });

  return json(200, payload);
});
