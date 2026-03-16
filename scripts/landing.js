import { requestJson } from "/scripts/shared.js";

const LEADERBOARD_STORAGE_KEY = "uwzoom-leaderboard";
const leaderboardList = document.querySelector("#landing-leaderboard-list");
const leaderboardEmpty = document.querySelector("#landing-leaderboard-empty");
const uploadCountList = document.querySelector("#upload-count-list");
const uploadCountEmpty = document.querySelector("#upload-count-empty");

renderLandingLeaderboard();
renderUploadCounts();

function renderLandingLeaderboard() {
  if (!leaderboardList || !leaderboardEmpty) {
    return;
  }

  const entries = loadLeaderboardEntries().slice(0, 5);
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

    const rank = document.createElement("span");
    rank.className = "landing-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const score = document.createElement("strong");
    score.className = "landing-leaderboard-score";
    score.textContent = `${normalizeScore(entry.score)} in a row`;

    item.append(rank, score);
    fragment.append(item);
  });

  leaderboardList.append(fragment);
  leaderboardList.hidden = false;
  leaderboardEmpty.hidden = true;
}

function loadLeaderboardEntries() {
  try {
    const rawValue = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const parsed = JSON.parse(rawValue || "[]");

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && Number.isFinite(Number(entry.score)))
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  } catch {
    return [];
  }
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
