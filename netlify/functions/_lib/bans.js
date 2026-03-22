import { HttpError } from "./http.js";
import { getJson, putJson, storageConfigured } from "./storage.js";
import { getClientIp, normalizeIp } from "./ip.js";

const BANNED_IPS_KEY = "app/admin/banned-ips.json";

export async function loadBannedIps() {
  if (!storageConfigured()) {
    return [];
  }

  const payload = await getJson(BANNED_IPS_KEY);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];

  return entries
    .map(normalizeBanEntry)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.bannedAt || 0) - Date.parse(left.bannedAt || 0));
}

export async function isIpBanned(ip) {
  const normalizedIp = normalizeIp(ip);

  if (!normalizedIp || normalizedIp === "Unknown") {
    return false;
  }

  const entries = await loadBannedIps();
  return entries.some((entry) => entry.ip === normalizedIp);
}

export async function requireNotBanned(event, scope = "using this part of uwZoom.com") {
  const ip = getClientIp(event);

  if (await isIpBanned(ip)) {
    throw new HttpError(403, `This IP address has been banned from ${scope}.`);
  }
}

export async function banIp(ip, metadata = {}) {
  const normalizedIp = normalizeIp(ip);

  if (!normalizedIp || normalizedIp === "Unknown") {
    throw new HttpError(400, "A valid IP address is required.");
  }

  const entries = await loadBannedIps();
  const nextEntries = [
    {
      ip: normalizedIp,
      label: normalizeLabel(metadata.label),
      source: normalizeLabel(metadata.source),
      bannedAt: new Date().toISOString(),
    },
    ...entries.filter((entry) => entry.ip !== normalizedIp),
  ];

  await putJson(BANNED_IPS_KEY, {
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  });

  return nextEntries;
}

export async function unbanIp(ip) {
  const normalizedIp = normalizeIp(ip);
  const entries = await loadBannedIps();
  const nextEntries = entries.filter((entry) => entry.ip !== normalizedIp);

  await putJson(BANNED_IPS_KEY, {
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  });

  return nextEntries;
}

function normalizeBanEntry(value) {
  const ip = normalizeIp(value?.ip);

  if (!ip || ip === "Unknown") {
    return null;
  }

  return {
    ip,
    label: normalizeLabel(value?.label),
    source: normalizeLabel(value?.source),
    bannedAt: normalizeTimestamp(value?.bannedAt),
  };
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
