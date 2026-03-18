import { getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { startPrivateOnlineDuelRoom } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  await requireNotBanned(event, "starting private rooms");

  const body = parseJsonBody(event);
  const payload = await startPrivateOnlineDuelRoom({
    origin: getOrigin(event),
    playerId: body.playerId,
    token: body.token,
  });

  return json(200, payload);
});
