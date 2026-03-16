import { requestJson, setStatus } from "/scripts/shared.js";

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

const result = loadResult();

renderResult(result);
initLeaderboardForm(result);

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

  leaderboardForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = normalizePlayerName(leaderboardNameInput.value);

    if (!name) {
      setStatus(leaderboardStatus, "Type your name before jumping into another run.", "warning");
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
        },
      });

      window.location.assign("/play/");
    } catch (error) {
      setStatus(leaderboardStatus, error.message, "error");
      if (playAgainButton) {
        playAgainButton.disabled = false;
      }
    }
  });
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

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function loadResult() {
  const params = new URLSearchParams(window.location.search);

  return {
    result: params.get("result") || "loss",
    score: params.get("score") || "0",
    highScore: params.get("highScore") || "0",
    answer: params.get("answer") || "",
    durationMs: params.get("durationMs") || "0",
  };
}
