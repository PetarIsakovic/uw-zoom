export async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message =
      payload?.error || payload?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

const PENDING_ONLINE_LEAVE_STORAGE_KEY = "uwzoom.pendingOnlineLeave";

const PROFANITY_PATTERNS = [
  /motherfucker/giu,
  /niggers?/giu,
  /niggas?/giu,
  /faggots?/giu,
  /retards?/giu,
  /assholes?/giu,
  /bitches?/giu,
  /bastards?/giu,
  /whores?/giu,
  /sluts?/giu,
  /puss(y|ies)/giu,
  /cunts?/giu,
  /dicks?/giu,
  /cocks?/giu,
  /fucks?/giu,
  /fucking/giu,
  /fucked/giu,
  /shits?/giu,
  /shitty/giu,
  /\bfag\b/giu,
];

export function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function censorProfanity(value, options = {}) {
  const maxLength = Number.isFinite(Number(options.maxLength))
    ? Math.max(0, Math.floor(Number(options.maxLength)))
    : Number.POSITIVE_INFINITY;
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

  return PROFANITY_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, (match) => "#".repeat(match.length)),
    normalized,
  );
}

export function csvToArray(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function setStatus(element, message, tone = "default") {
  element.textContent = message;
  element.dataset.tone = tone;
}

export function stashPendingOnlineLeave(value) {
  const payload = normalizePendingOnlineLeave(value);

  if (!payload) {
    return;
  }

  try {
    window.localStorage.setItem(PENDING_ONLINE_LEAVE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures so gameplay is not blocked.
  }
}

export function clearPendingOnlineLeave() {
  try {
    window.localStorage.removeItem(PENDING_ONLINE_LEAVE_STORAGE_KEY);
  } catch {
    // Ignore storage failures so gameplay is not blocked.
  }
}

export async function flushPendingOnlineLeave() {
  const payload = readPendingOnlineLeave();

  if (!payload) {
    return false;
  }

  try {
    const response = await fetch("/api/online-duel-leave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 401 || response.status === 404) {
      clearPendingOnlineLeave();
      return true;
    }
  } catch {
    // Keep the pending payload so the next page load can retry it.
  }

  return false;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function readPendingOnlineLeave() {
  try {
    return normalizePendingOnlineLeave(
      safeJsonParse(window.localStorage.getItem(PENDING_ONLINE_LEAVE_STORAGE_KEY) || ""),
    );
  } catch {
    return null;
  }
}

function normalizePendingOnlineLeave(value) {
  const playerId = String(value?.playerId || "").trim();
  const token = String(value?.token || "").trim();

  if (!playerId || !token) {
    return null;
  }

  return { playerId, token };
}
