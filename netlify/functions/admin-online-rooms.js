import { requireAdmin } from "./_lib/admin.js";
import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { adminEndOnlineDuelRoom } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);
  if (preflight) return preflight;

  ensureMethod(event, ["POST"]);
  requireAdmin(event);

  const body = JSON.parse(event.body || "{}");
  const result = await adminEndOnlineDuelRoom({ roomId: body.roomId });
  return json(200, result);
});
