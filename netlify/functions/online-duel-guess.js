import { getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { requireRateLimit } from "./_lib/rate-limit.js";
import { submitOnlineDuelGuess } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  await requireNotBanned(event, "joining online matches");
  await requireRateLimit(event, "online-duel-guess", {
    maxRequests: 120,
    windowMs: 10 * 60 * 1000,
    message: "Too many online guesses from this connection. Slow down a bit.",
  });

  const body = parseJsonBody(event);
  const payload = await submitOnlineDuelGuess({
    origin: getOrigin(event),
    playerId: body.playerId,
    token: body.token,
    guess: body.guess,
  });

  return json(200, payload);
});
