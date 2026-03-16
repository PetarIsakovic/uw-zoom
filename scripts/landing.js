import { requestJson } from "/scripts/shared.js";

const leaderboardList = document.querySelector("#landing-leaderboard-list");
const leaderboardEmpty = document.querySelector("#landing-leaderboard-empty");
const uploadCountList = document.querySelector("#upload-count-list");
const uploadCountEmpty = document.querySelector("#upload-count-empty");

renderLandingLeaderboard();
renderUploadCounts();

async function renderLandingLeaderboard() {
  if (!leaderboardList || !leaderboardEmpty) {
    return;
  }

  let entries = [];

  try {
    const payload = await requestJson("/api/leaderboard");
    entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 5) : [];
  } catch {
    entries = [];
  }

  leaderboardList.replaceChildren();

  if (!entries.length) {
    leaderboardList.hidden = true;
    leaderboardEmpty.hidden = false;
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "landing-leaderboard-entry";

    const player = document.createElement("div");
    player.className = "landing-leaderboard-player";

    const rank = document.createElement("span");
    rank.className = "landing-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "landing-leaderboard-name";
    name.textContent = normalizeLeaderboardName(entry.name);

    const metrics = document.createElement("div");
    metrics.className = "landing-leaderboard-metrics";

    const score = document.createElement("strong");
    score.className = "landing-leaderboard-score";
    score.textContent = `${normalizeScore(entry.score)} in a row`;

    const duration = document.createElement("span");
    duration.className = "landing-leaderboard-time";

    const formattedDuration = formatDuration(entry.durationMs);

    if (formattedDuration) {
      duration.textContent = `in ${formattedDuration}`;
      metrics.append(score, duration);
    } else {
      metrics.append(score);
    }

    player.append(rank, name);
    item.append(player, metrics);
    fragment.append(item);
  });

  leaderboardList.append(fragment);
  leaderboardList.hidden = false;
  leaderboardEmpty.hidden = true;
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeLeaderboardName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);

  return normalized || "Anonymous";
}

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
}

function formatDuration(value) {
  const durationMs = normalizeDurationMs(value);

  if (!Number.isFinite(durationMs)) {
    return "";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function renderUploadCounts() {
  if (!uploadCountList || !uploadCountEmpty) {
    return;
  }

  let leaders = [];

  try {
    const payload = await requestJson("/api/upload-stats");
    leaders = Array.isArray(payload.leaders) ? payload.leaders : [];
  } catch {
    // Leave the leaderboard empty when upload stats are unavailable.
  }

  uploadCountList.replaceChildren();

  if (!leaders.length) {
    uploadCountList.hidden = true;
    uploadCountEmpty.hidden = false;
    return;
  }

  const fragment = document.createDocumentFragment();

  leaders.slice(0, 5).forEach((entry) => {
    const item = document.createElement("li");
    item.className = "landing-leaderboard-entry";

    const name = document.createElement("span");
    name.className = "landing-leaderboard-name";
    name.textContent = String(entry.name || "Anonymous");

    const value = document.createElement("strong");
    value.className = "landing-leaderboard-score";

    const uploads = normalizeScore(entry.uploads);
    value.textContent = `${uploads} upload${uploads === 1 ? "" : "s"}`;

    item.append(name, value);
    fragment.append(item);
  });

  uploadCountList.append(fragment);
  uploadCountList.hidden = false;
  uploadCountEmpty.hidden = true;
}
