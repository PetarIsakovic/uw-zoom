import { requireAdmin } from "./_lib/admin.js";
import { HttpError, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { banIp, loadBannedIps, unbanIp } from "./_lib/bans.js";
import { normalizeIp } from "./_lib/ip.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET", "POST"]);
  requireAdmin(event);

  if (event.httpMethod === "GET") {
    return json(200, {
      bans: await loadBannedIps(),
    });
  }

  const body = parseJsonBody(event);
  const action = String(body.action || "").trim().toLowerCase();
  const ip = normalizeIp(body.ip);

  if (!ip || ip === "Unknown") {
    throw new HttpError(400, "A valid IP address is required.");
  }

  if (action === "ban") {
    return json(200, {
      success: true,
      bans: await banIp(ip, {
        label: String(body.label || "").trim(),
        source: String(body.source || "").trim(),
      }),
    });
  }

  if (action === "unban") {
    return json(200, {
      success: true,
      bans: await unbanIp(ip),
    });
  }

  throw new HttpError(400, "Action must be ban or unban.");
});
