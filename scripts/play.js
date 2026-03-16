import { normalizeAnswer, requestJson, setStatus } from "/scripts/shared.js";
import { buildDemoImages } from "/shared/demo-images.js";
import { WORD_BANK, createWordBankIndex, searchInWordBank } from "/shared/word-bank.js";

const MAX_WRONG_GUESSES = 4;
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.45, 1];

const guessMeter = document.querySelector("#guess-meter");
const streakMeter = document.querySelector("#streak-meter");
const feedback = document.querySelector("#feedback");
const image = document.querySelector("#game-image");
const form = document.querySelector("#guess-form");
const input = document.querySelector("#guess-input");
const nextButton = document.querySelector("#next-button");
const summaryCard = document.querySelector("#game-summary");
const summaryCopy = document.querySelector("#game-summary-copy");
const githubPrompt = document.querySelector("#game-github-prompt");
const uploadPrompt = document.querySelector("#game-upload-prompt");
const suggestionPanel = document.querySelector("#guess-suggestions");
const HIGH_SCORE_STORAGE_KEY = "uwzoom-high-score";
let wordBank = [];
let wordBankIndex = createWordBankIndex([]);

const state = {
  images: [],
  current: null,
  runQueue: [],
  wrongGuesses: 0,
  roundLocked: true,
  streak: 0,
  highScore: loadHighScore(),
};

init();

input.addEventListener("input", () => {
  renderSuggestions(input.value);
});

input.addEventListener("focus", () => {
  renderSuggestions(input.value);
});

document.addEventListener("click", (event) => {
  if (
    suggestionPanel &&
    !suggestionPanel.hidden &&
    !suggestionPanel.contains(event.target) &&
    event.target !== input
  ) {
    hideSuggestions();
  }
});

suggestionPanel?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-word-bank-value]");

  if (!button) {
    return;
  }

  input.value = button.dataset.wordBankValue || "";
  hideSuggestions();
  input.focus();
});

async function init() {
  try {
    const [imagesResult, wordBankResult] = await Promise.allSettled([
      requestJson("/api/approved-images"),
      requestJson("/api/word-bank"),
    ]);

    const fallbackImages = buildDemoImages(window.location.origin);
    state.images =
      imagesResult.status === "fulfilled" && Array.isArray(imagesResult.value.images)
        ? imagesResult.value.images
        : fallbackImages;
    wordBank =
      wordBankResult.status === "fulfilled" && Array.isArray(wordBankResult.value.words)
        ? wordBankResult.value.words
        : WORD_BANK;
    wordBankIndex = createWordBankIndex(wordBank);

    if (!state.images.length) {
      throw new Error("No approved images are available yet.");
    }

    startNewGame();
  } catch (error) {
    form.hidden = true;
    setStatus(feedback, error.message, "error");
    guessMeter.textContent = "Waiting";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (state.roundLocked || !state.current) {
    return;
  }

  const resolvedGuess = wordBankIndex.get(normalizeAnswer(input.value)) || null;

  if (!input.value.trim()) {
    setStatus(feedback, "Type a guess before submitting.", "warning");
    return;
  }

  if (!resolvedGuess) {
    setStatus(feedback, "Choose a guess from the word bank suggestions.", "warning");
    renderSuggestions(input.value);
    return;
  }

  input.value = resolvedGuess;
  hideSuggestions();

  const guess = normalizeAnswer(resolvedGuess);

  if (isCorrectGuess(guess, state.current)) {
    state.roundLocked = true;
    state.streak += 1;
    revealImage(false);
    updateStreakMeter();

    if (!state.runQueue.length) {
      state.highScore = Math.max(state.highScore, state.streak);
      saveHighScore(state.highScore);
      setStatus(
        feedback,
        `Correct. It was ${state.current.answer}. We ran out of images and you won.`,
        "success",
      );
      guessMeter.textContent = "All cleared";
      nextButton.hidden = false;
      showSummary("win", state.streak, state.highScore);
      showGithubPrompt();
      return;
    }

    setStatus(
      feedback,
      `Correct. It was ${state.current.answer}. Streak ${state.streak}. Next image loading...`,
      "success",
    );
    guessMeter.textContent = `${state.wrongGuesses} wrong`;
    window.setTimeout(() => {
      if (state.roundLocked) {
        loadNextRound();
      }
    }, 1100);
    return;
  }

  state.wrongGuesses += 1;

  if (state.wrongGuesses >= MAX_WRONG_GUESSES) {
    state.roundLocked = true;
    const score = state.streak;
    state.highScore = Math.max(state.highScore, score);
    saveHighScore(state.highScore);
    state.streak = 0;
    revealImage(true);
    setStatus(
      feedback,
      `Out of guesses. The answer was ${state.current.answer}.`,
      "error",
    );
    guessMeter.textContent = "0 guesses left";
    updateStreakMeter();
    nextButton.hidden = false;
    showSummary("loss", score, state.highScore);
    showGithubPrompt();
    return;
  }

  updateZoom();
  updateGuessMeter();
  setStatus(feedback, "Not quite. The image just zoomed out a little more.", "warning");
  input.select();
});

nextButton.addEventListener("click", () => {
  startNewGame();
});

function startNewGame() {
  state.runQueue = shuffleArray(state.images);
  state.streak = 0;
  updateStreakMeter();
  hideSummary();
  hideGithubPrompt();
  loadNextRound();
}

function loadNextRound() {
  state.current = state.runQueue.shift();

  if (!state.current) {
    return;
  }

  state.wrongGuesses = 0;
  state.roundLocked = false;

  image.src = state.current.imageUrl;
  image.alt = `Mystery image for ${state.current.answer}`;
  image.style.transformOrigin = `${state.current.focusX || 50}% ${state.current.focusY || 50}%`;
  updateZoom();

  form.reset();
  input.disabled = false;
  input.focus();
  nextButton.hidden = true;
  hideSuggestions();
  updateGuessMeter();
  updateStreakMeter();
  setStatus(feedback, "Guess what the image is before the fourth miss reveals everything.");
}

function updateZoom() {
  const scale = ZOOM_LEVELS[Math.min(state.wrongGuesses, ZOOM_LEVELS.length - 1)];
  image.style.transform = `scale(${scale})`;
}

function revealImage(isGameOver) {
  if (isGameOver) {
    state.wrongGuesses = MAX_WRONG_GUESSES;
  }

  image.style.transform = "scale(1)";
  input.disabled = true;
}

function updateGuessMeter() {
  const guessesLeft = Math.max(0, MAX_WRONG_GUESSES - state.wrongGuesses);
  guessMeter.textContent = `${guessesLeft} guess${guessesLeft === 1 ? "" : "es"} left`;
}

function updateStreakMeter() {
  streakMeter.textContent = `Streak ${state.streak}`;
}

function isCorrectGuess(guess, imageData) {
  const answers = [imageData.answer, ...(imageData.acceptedAnswers || [])]
    .map(normalizeAnswer)
    .filter(Boolean);

  return answers.some((answer) => {
    const shortestLength = Math.min(answer.length, guess.length);
    return answer === guess || (shortestLength >= 4 && (answer.includes(guess) || guess.includes(answer)));
  });
}

function showGithubPrompt() {
  if (githubPrompt) {
    githubPrompt.hidden = false;
  }

  if (uploadPrompt) {
    uploadPrompt.hidden = false;
  }
}

function hideGithubPrompt() {
  if (githubPrompt) {
    githubPrompt.hidden = true;
  }

  if (uploadPrompt) {
    uploadPrompt.hidden = true;
  }
}

function showSummary(result, score, highScore) {
  if (!summaryCard || !summaryCopy) {
    return;
  }

  summaryCopy.textContent =
    result === "win"
      ? `We ran out of images. You won with a score of ${score}. High score ${highScore}.`
      : `Game over. Score ${score}. High score ${highScore}.`;
  summaryCard.hidden = false;
}

function hideSummary() {
  if (summaryCard) {
    summaryCard.hidden = true;
  }
}

function renderSuggestions(query) {
  if (!suggestionPanel) {
    return;
  }

  const suggestions = searchInWordBank(wordBank, query, 8);

  if (!query.trim()) {
    hideSuggestions();
    return;
  }

  suggestionPanel.hidden = false;

  if (!suggestions.length) {
    suggestionPanel.innerHTML =
      '<p class="suggestions-empty">No word bank matches yet. Try a UW place, object, or campus term.</p>';
    return;
  }

  suggestionPanel.innerHTML = suggestions
    .map(
      (value) =>
        `<button class="suggestion-button" type="button" data-word-bank-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`,
    )
    .join("");
}

function hideSuggestions() {
  if (!suggestionPanel) {
    return;
  }

  suggestionPanel.hidden = true;
  suggestionPanel.innerHTML = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function saveHighScore(value) {
  try {
    window.localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures and continue without persistence.
  }
}

function shuffleArray(values) {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}
