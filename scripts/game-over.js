import { ensureAvatarIconAssets, drawAvatarIcon } from "/scripts/avatar-icon.js";
import { readAvatarSelectionFromSearchParams } from "/shared/avatar-selection.js";
import { censorProfanity, requestJson, setStatus } from "/scripts/shared.js";

const eyebrow = document.querySelector("#result-eyebrow");
const title = document.querySelector("#result-title");
const copy = document.querySelector("#result-copy");
const answer = document.querySelector("#result-answer");
const scoreValue = document.querySelector("#score-value");
const highScoreValue = document.querySelector("#high-score-value");
const durationValue = document.querySelector("#duration-value");
const leaderboardForm = document.querySelector("#leaderboard-form");
const leaderboardNameInput = document.querySelector("#leaderboard-name");
const leaderboardStatus = document.querySelector("#leaderboard-status");
const playAgainButton = document.querySelector("#play-again-button");
const topStreaksBoard = document.querySelector("#game-over-top-streaks-board");
const topStreaksList = document.querySelector("#game-over-top-streaks-list");
const topStreaksEmpty = document.querySelector("#game-over-top-streaks-empty");
const onlineWinsBoard = document.querySelector("#game-over-online-wins-board");
const onlineWinsList = document.querySelector("#game-over-online-wins-list");
const onlineWinsEmpty = document.querySelector("#game-over-online-wins-empty");

const result = loadResult();

renderResult(result);
initLeaderboardForm(result);
void renderTopStreaks();
void renderOnlineWins();

function renderResult(result) {
  const score = normalizeScore(result.score);
  const highScore = normalizeScore(result.highScore);
  const durationMs = normalizeDurationMs(result.durationMs);
  const didWin = result.result === "win";

  if (eyebrow) {
    eyebrow.textContent = didWin ? "You won" : "Game over";
  }

  if (title) {
    title.textContent = didWin ? "All images cleared" : "Run ended";
  }

  if (copy) {
    copy.textContent = didWin
      ? `You cleared every image in ${formatDuration(durationMs)} with a score of ${score}.`
      : `You finished with a score of ${score} in ${formatDuration(durationMs)}.`;
  }

  if (answer) {
    if (result.answer) {
      answer.textContent = didWin
        ? `Last image: ${result.answer}.`
        : `The last image was ${result.answer}.`;
      answer.hidden = false;
    } else {
      answer.hidden = true;
    }
  }

  if (scoreValue) {
    scoreValue.textContent = String(score);
  }

  if (highScoreValue) {
    highScoreValue.textContent = String(highScore);
  }

  if (durationValue) {
    durationValue.textContent = formatDuration(durationMs);
  }
}

function initLeaderboardForm(result) {
  if (!leaderboardForm || !leaderboardNameInput || !leaderboardStatus) {
    return;
  }

  if (result.name) {
    leaderboardNameInput.value = normalizePlayerName(result.name);
  }

  leaderboardForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = normalizePlayerName(leaderboardNameInput.value);

    if (!name) {
      setStatus(leaderboardStatus, "Type your name before going back home.", "warning");
      leaderboardNameInput.focus();
      return;
    }

    leaderboardNameInput.value = name;
    if (playAgainButton) {
      playAgainButton.disabled = true;
    }

    try {
      setStatus(leaderboardStatus, "Saving your run...", "default");

      await requestJson("/api/leaderboard", {
        method: "POST",
        body: {
          ...result,
          name,
          avatar: result.avatar,
        },
      });

      window.location.assign("/");
    } catch (error) {
      setStatus(leaderboardStatus, error.message, "error");
      if (playAgainButton) {
        playAgainButton.disabled = false;
      }
    }
  });
}

async function renderTopStreaks() {
  if (!topStreaksBoard || !topStreaksList || !topStreaksEmpty) {
    return;
  }

  await ensureAvatarIconAssets().catch(() => {});

  let entries = [];

  try {
    const payload = await requestJson("/api/leaderboard");
    entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 5) : [];
  } catch {
    entries = [];
  }

  topStreaksList.replaceChildren();

  if (!entries.length) {
    topStreaksList.hidden = true;
    topStreaksEmpty.hidden = false;
    topStreaksBoard.dataset.state = "empty";
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "game-over-leaderboard-entry";

    const player = document.createElement("div");
    player.className = "game-over-leaderboard-player";

    const identity = document.createElement("div");
    identity.className = "game-over-leaderboard-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "game-over-leaderboard-avatar";
    avatar.width = 36;
    avatar.height = 36;
    drawAvatarIcon(avatar, entry.avatar);

    const rank = document.createElement("span");
    rank.className = "game-over-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "game-over-leaderboard-name";
    name.textContent = normalizePlayerName(entry.name) || "Anonymous";

    const copy = document.createElement("div");
    copy.className = "game-over-leaderboard-copy";
    copy.append(rank, name);

    const metrics = document.createElement("div");
    metrics.className = "game-over-leaderboard-metrics";

    const score = document.createElement("strong");
    score.className = "game-over-leaderboard-score";
    score.textContent = `${normalizeScore(entry.score)} in a row`;

    const duration = document.createElement("span");
    duration.className = "game-over-leaderboard-time";
    const formattedDuration = formatDurationForBoard(entry.durationMs);

    if (formattedDuration) {
      duration.textContent = `in ${formattedDuration}`;
      metrics.append(score, duration);
    } else {
      metrics.append(score);
    }

    identity.append(avatar, copy);
    player.append(identity);
    item.append(player, metrics);
    fragment.append(item);
  });

  topStreaksList.append(fragment);
  topStreaksList.hidden = false;
  topStreaksEmpty.hidden = true;
  topStreaksBoard.dataset.state = "ready";
}

async function renderOnlineWins() {
  if (!onlineWinsBoard || !onlineWinsList || !onlineWinsEmpty) {
    return;
  }

  await ensureAvatarIconAssets().catch(() => {});

  let leaders = [];

  try {
    const payload = await requestJson("/api/online-wins");
    leaders = Array.isArray(payload.leaders) ? payload.leaders.slice(0, 5) : [];
  } catch {
    leaders = [];
  }

  onlineWinsList.replaceChildren();

  if (!leaders.length) {
    onlineWinsList.hidden = true;
    onlineWinsEmpty.hidden = false;
    onlineWinsBoard.dataset.state = "empty";
    return;
  }

  const fragment = document.createDocumentFragment();

  leaders.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "game-over-leaderboard-entry";

    const player = document.createElement("div");
    player.className = "game-over-leaderboard-player";

    const identity = document.createElement("div");
    identity.className = "game-over-leaderboard-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "game-over-leaderboard-avatar";
    avatar.width = 36;
    avatar.height = 36;
    drawAvatarIcon(avatar, entry.avatar);

    const rank = document.createElement("span");
    rank.className = "game-over-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "game-over-leaderboard-name";
    name.textContent = normalizePlayerName(entry.name) || "Anonymous";

    const copy = document.createElement("div");
    copy.className = "game-over-leaderboard-copy";
    copy.append(rank, name);

    const metrics = document.createElement("div");
    metrics.className = "game-over-leaderboard-metrics";

    const wins = document.createElement("strong");
    wins.className = "game-over-leaderboard-score";
    const count = normalizeScore(entry.wins);
    wins.textContent = `${count} win${count === 1 ? "" : "s"}`;

    identity.append(avatar, copy);
    player.append(identity);
    metrics.append(wins);
    item.append(player, metrics);
    fragment.append(item);
  });

  onlineWinsList.append(fragment);
  onlineWinsList.hidden = false;
  onlineWinsEmpty.hidden = true;
  onlineWinsBoard.dataset.state = "ready";
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatDuration(value) {
  const durationMs = normalizeDurationMs(value);
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationForBoard(value) {
  const durationMs = Number(value);

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  return formatDuration(durationMs);
}

function normalizePlayerName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function loadResult() {
  const params = new URLSearchParams(window.location.search);

  return {
    result: params.get("result") || "loss",
    score: params.get("score") || "0",
    highScore: params.get("highScore") || "0",
    answer: params.get("answer") || "",
    durationMs: params.get("durationMs") || "0",
    name: params.get("name") || "",
    avatar: readAvatarSelectionFromSearchParams(params),
  };
}
