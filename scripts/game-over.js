const HIGH_SCORE_STORAGE_KEY = "uwzoom-high-score";
const LAST_RESULT_STORAGE_KEY = "uwzoom-last-result";

const eyebrow = document.querySelector("#result-eyebrow");
const title = document.querySelector("#result-title");
const copy = document.querySelector("#result-copy");
const answer = document.querySelector("#result-answer");
const scoreValue = document.querySelector("#score-value");
const highScoreValue = document.querySelector("#high-score-value");

renderResult(loadResult());

function renderResult(result) {
  const score = normalizeScore(result.score);
  const highScore = normalizeScore(result.highScore ?? loadHighScore());
  const didWin = result.result === "win";

  if (eyebrow) {
    eyebrow.textContent = didWin ? "You won" : "Game over";
  }

  if (title) {
    title.textContent = didWin ? "All images cleared" : "Run ended";
  }

  if (copy) {
    copy.textContent = didWin
      ? `You cleared every image in the pool with a score of ${score}.`
      : `You finished with a score of ${score}.`;
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
}

function loadResult() {
  const storedResult = loadStoredResult();

  if (storedResult) {
    return storedResult;
  }

  const params = new URLSearchParams(window.location.search);
  return {
    result: params.get("result") || "loss",
    score: params.get("score") || "0",
    highScore: params.get("highScore") || String(loadHighScore()),
    answer: params.get("answer") || "",
  };
}

function loadStoredResult() {
  try {
    const rawValue = window.sessionStorage.getItem(LAST_RESULT_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    window.sessionStorage.removeItem(LAST_RESULT_STORAGE_KEY);
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function loadHighScore() {
  try {
    const value = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
