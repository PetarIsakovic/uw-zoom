import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { getClientIp, normalizeIp } from "./ip.js";
import { getJson, putJson, storageConfigured } from "./storage.js";

const RATE_LIMIT_PREFIX = "app/rate-limits";

export async function requireRateLimit(event, scope, options = {}) {
  if (!storageConfigured()) {
    return;
  }

  const normalizedIp = normalizeIp(getClientIp(event));

  if (!normalizedIp || normalizedIp === "Unknown") {
    return;
  }

  const windowMs = normalizeWindowMs(options.windowMs);
  const maxRequests = normalizeMaxRequests(options.maxRequests);
  const now = Date.now();
  const key = buildRateLimitKey(scope, normalizedIp);
  const payload = await getJson(key);
  const recentHits = Array.isArray(payload?.hits)
    ? payload.hits
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && now - value < windowMs)
    : [];

  if (recentHits.length >= maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((recentHits[0] + windowMs - now) / 1000),
    );

    throw new HttpError(
      429,
      options.message || "Too many requests. Try again in a few minutes.",
      {
        "Retry-After": String(retryAfterSeconds),
      },
    );
  }

  recentHits.push(now);

  await putJson(key, {
    scope: sanitizeScope(scope),
    updatedAt: new Date(now).toISOString(),
    hits: recentHits,
  });
}

function buildRateLimitKey(scope, ip) {
  const scopeSegment = sanitizeScope(scope);
  const ipHash = createHash("sha256").update(ip).digest("hex");

  return `${RATE_LIMIT_PREFIX}/${scopeSegment}/${ipHash}.json`;
}

function sanitizeScope(value) {
  return String(value || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";
}

function normalizeWindowMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

function normalizeMaxRequests(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
}
