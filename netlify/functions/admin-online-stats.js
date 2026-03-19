import { requireAdmin } from "./_lib/admin.js";
import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { loadOnlineDuelAdminStats } from "./_lib/online-duel.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);
  requireAdmin(event);

  const payload = await loadOnlineDuelAdminStats();
  return json(200, payload);
});
