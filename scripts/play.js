import { normalizeAnswer, requestJson, setStatus } from "/scripts/shared.js";
import { buildDemoImages } from "/shared/demo-images.js";
import { WORD_BANK, createWordBankIndex } from "/shared/word-bank.js";

const MAX_WRONG_GUESSES = 4;
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.45, 1];

const guessMeter = document.querySelector("#guess-meter");
const streakMeter = document.querySelector("#streak-meter");
const feedback = document.querySelector("#feedback");
const image = document.querySelector("#game-image");
const form = document.querySelector("#guess-form");
const input = document.querySelector("#guess-input");
const ghostTyped = document.querySelector("#ghost-typed");
const ghostSuffix = document.querySelector("#ghost-suffix");
const suggestionsPanel = document.querySelector("#suggestions-panel");
const playLoading = document.querySelector("#play-loading");
const playLoadingCopy = document.querySelector("#play-loading-copy");
const GAME_OVER_DELAY_MS = 950;
let wordBank = [];
let wordBankIndex = createWordBankIndex([]);

const state = {
  images: [],
  current: null,
  runQueue: [],
  runStartedAt: 0,
  wrongGuesses: 0,
  roundLocked: true,
  streak: 0,
  highScore: 0,
  inlineSuggestion: "",
  roundLoadToken: 0,
};

init();

input.addEventListener("input", () => {
  updateAutocomplete();
});

input.addEventListener("focus", () => {
  updateAutocomplete();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && hasInlineSuggestion()) {
    event.preventDefault();
    acceptInlineSuggestion();
    return;
  }

  if (event.key === "ArrowRight" && hasInlineSuggestion()) {
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const caretAtEnd =
      selectionStart === input.value.length && selectionEnd === input.value.length;

    if (caretAtEnd) {
      event.preventDefault();
      acceptInlineSuggestion();
      return;
    }
  }

  if (event.key === "Enter" && hasInlineSuggestion()) {
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const caretAtEnd =
      selectionStart === input.value.length && selectionEnd === input.value.length;

    if (caretAtEnd) {
      event.preventDefault();
      acceptInlineSuggestion();
      return;
    }
  }

  if (event.key === "Escape") {
    clearInlineSuggestion();
    renderSuggestionPanel([]);
  }
});

async function init() {
  try {
    const [imagesResult, wordBankResult, leaderboardResult] = await Promise.allSettled([
      requestJson("/api/approved-images"),
      requestJson("/api/word-bank"),
      requestJson("/api/leaderboard"),
    ]);

    const fatalError =
      resolveFatalApiError(imagesResult, "banned from playing") ||
      resolveFatalApiError(wordBankResult, "banned from playing");

    if (fatalError) {
      throw fatalError;
    }

    const fallbackImages = buildDemoImages(window.location.origin);
    state.images =
      imagesResult.status === "fulfilled" && Array.isArray(imagesResult.value.images)
        ? imagesResult.value.images
        : fallbackImages;
    wordBank =
      wordBankResult.status === "fulfilled" && Array.isArray(wordBankResult.value.words)
        ? wordBankResult.value.words
        : WORD_BANK;
    state.highScore =
      leaderboardResult.status === "fulfilled"
        ? normalizeScore(leaderboardResult.value.highScore)
        : 0;
    wordBankIndex = createWordBankIndex(wordBank);

    if (!state.images.length) {
      throw new Error("No approved images are available yet.");
    }

    void startNewGame();
  } catch (error) {
    form.hidden = true;
    setPlayLoading(true, error.message || "We could not start the game.");
    setStatus(feedback, error.message, "error");
    if (guessMeter) {
      guessMeter.textContent = "Waiting";
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (state.roundLocked || !state.current) {
    return;
  }

  const typedGuess = normalizeAnswer(input.value);
  const resolvedGuess = wordBankIndex.get(typedGuess) || null;

  if (!input.value.trim()) {
    setStatus(feedback, "Type a guess before submitting.", "warning");
    return;
  }

  if (!resolvedGuess) {
    setStatus(feedback, "That guess is not in the word bank.", "warning");
    return;
  }

  input.value = resolvedGuess;
  clearInlineSuggestion();

  const guess = normalizeAnswer(resolvedGuess);

  if (isCorrectGuess(guess, state.current)) {
    state.roundLocked = true;
    state.streak += 1;
    revealImage(false);
    updateStreakMeter();

    if (!state.runQueue.length) {
      state.highScore = Math.max(state.highScore, state.streak);
      setStatus(
        feedback,
        `Correct. It was ${state.current.answer}. We ran out of images and you won.`,
        "success",
      );
      goToGameOver({
        result: "win",
        score: state.streak,
        highScore: state.highScore,
        answer: state.current.answer,
      });
      return;
    }

    setStatus(
      feedback,
      `Correct. It was ${state.current.answer}. Streak ${state.streak}. Next image loading...`,
      "success",
    );
    window.setTimeout(() => {
      if (state.roundLocked) {
        void loadNextRound();
      }
    }, 1100);
    return;
  }

  state.wrongGuesses += 1;

  if (state.wrongGuesses >= MAX_WRONG_GUESSES) {
    state.roundLocked = true;
    const score = state.streak;
    state.highScore = Math.max(state.highScore, score);
    state.streak = 0;
    revealImage(true);
    setStatus(
      feedback,
      `Out of guesses. The answer was ${state.current.answer}.`,
      "error",
    );
    updateStreakMeter();
    goToGameOver({
      result: "loss",
      score,
      highScore: state.highScore,
      answer: state.current.answer,
    });
    return;
  }

  updateZoom();
  updateGuessMeter();
  setStatus(feedback, "Not quite. The image just zoomed out a little more.", "warning");
  input.select();
});

function startNewGame() {
  state.runQueue = shuffleArray(state.images);
  state.runStartedAt = Date.now();
  state.streak = 0;
  updateStreakMeter();
  return loadNextRound({ isFirstRound: true });
}

async function loadNextRound(options = {}) {
  const nextRound = state.runQueue.shift();

  if (!nextRound) {
    return;
  }

  const isFirstRound = Boolean(options.isFirstRound);
  const loadToken = state.roundLoadToken + 1;
  state.roundLoadToken = loadToken;
  state.current = nextRound;
  state.wrongGuesses = 0;
  state.roundLocked = true;
  input.disabled = true;
  setPlayLoading(true, isFirstRound ? "Loading first image..." : "Loading next image...");

  form.reset();
  clearInlineSuggestion();
  renderSuggestionPanel([]);
  updateGuessMeter();
  updateStreakMeter();
  if (isFirstRound) {
    setStatus(feedback, "");
  }

  try {
    await preloadImage(nextRound.imageUrl);
  } catch {
    if (loadToken !== state.roundLoadToken) {
      return;
    }

    setPlayLoading(true, "We could not load this image. Try refreshing.");
    setStatus(feedback, "We could not load the next image.", "error");
    return;
  }

  if (loadToken !== state.roundLoadToken) {
    return;
  }

  image.src = nextRound.imageUrl;
  image.alt = `Mystery image for ${nextRound.answer}`;
  image.style.transformOrigin = `${nextRound.focusX || 50}% ${nextRound.focusY || 50}%`;
  updateZoom();
  state.roundLocked = false;
  input.disabled = false;
  input.focus();
  setPlayLoading(false);
  setStatus(feedback, "");
  void warmImageCache(state.runQueue[0]?.imageUrl);
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
  if (!guessMeter) {
    return;
  }

  const guessesLeft = Math.max(0, MAX_WRONG_GUESSES - state.wrongGuesses);
  guessMeter.textContent = `${guessesLeft} guess${guessesLeft === 1 ? "" : "es"} left`;
}

function updateStreakMeter() {
  if (!streakMeter) {
    return;
  }

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

function updateAutocomplete() {
  if (state.roundLocked || input.disabled) {
    renderSuggestionPanel([]);
    return;
  }

  const typedValue = input.value;
  const selectionStart = input.selectionStart ?? typedValue.length;
  const selectionEnd = input.selectionEnd ?? typedValue.length;
  const caretAtEnd = selectionStart === typedValue.length && selectionEnd === typedValue.length;
  const suggestions = getSuggestions(typedValue);

  if (!typedValue.trim() || !caretAtEnd) {
    state.inlineSuggestion = "";
    renderGhostSuggestion("");
    renderSuggestionPanel(suggestions);
    return;
  }

  const suggestion = findInlineSuggestion(typedValue);

  if (!suggestion || suggestion === typedValue) {
    state.inlineSuggestion = "";
    renderGhostSuggestion("");
    renderSuggestionPanel(suggestions);
    return;
  }

  state.inlineSuggestion = suggestion;
  renderGhostSuggestion(suggestion);
  renderSuggestionPanel(suggestions);
}

function findInlineSuggestion(query) {
  const normalizedQuery = normalizeAnswer(query);

  if (!normalizedQuery) {
    return "";
  }

  for (const entry of wordBank) {
    const normalizedEntry = normalizeAnswer(entry);

    if (normalizedEntry.startsWith(normalizedQuery)) {
      return entry;
    }
  }

  return "";
}

function getSuggestions(query, limit = 6) {
  const normalizedQuery = normalizeAnswer(query);

  if (!normalizedQuery) {
    return [];
  }

  const startsWithMatches = [];
  const includesMatches = [];

  for (const entry of wordBank) {
    const normalizedEntry = normalizeAnswer(entry);

    if (!normalizedEntry || normalizedEntry === normalizedQuery) {
      continue;
    }

    if (normalizedEntry.startsWith(normalizedQuery)) {
      startsWithMatches.push(entry);
      continue;
    }

    if (normalizedEntry.includes(normalizedQuery)) {
      includesMatches.push(entry);
    }
  }

  return [...startsWithMatches, ...includesMatches].slice(0, limit);
}

function renderSuggestionPanel(suggestions) {
  if (!suggestionsPanel) {
    return;
  }

  suggestionsPanel.replaceChildren();

  if (!suggestions.length) {
    suggestionsPanel.hidden = true;
    return;
  }

  for (const suggestion of suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-button";
    button.textContent = suggestion;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      applySuggestion(suggestion);
    });
    suggestionsPanel.append(button);
  }

  suggestionsPanel.hidden = false;
}

function applySuggestion(suggestion) {
  input.value = suggestion;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  clearInlineSuggestion();
  renderSuggestionPanel([]);
}

function acceptInlineSuggestion() {
  if (!hasInlineSuggestion()) {
    return;
  }

  applySuggestion(state.inlineSuggestion);
}

function renderGhostSuggestion(suggestion) {
  if (!ghostTyped || !ghostSuffix) {
    return;
  }

  const typedValue = input.value;
  ghostTyped.textContent = typedValue;
  ghostSuffix.textContent = suggestion.startsWith(typedValue)
    ? suggestion.slice(typedValue.length)
    : "";
}

function clearGhostSuggestion() {
  if (!ghostTyped || !ghostSuffix) {
    return;
  }

  ghostTyped.textContent = "";
  ghostSuffix.textContent = "";
}

function clearInlineSuggestion() {
  state.inlineSuggestion = "";
  clearGhostSuggestion();
}

function hasInlineSuggestion() {
  return Boolean(state.inlineSuggestion);
}

function setPlayLoading(isVisible, message = "Loading image...") {
  if (!playLoading) {
    return;
  }

  if (playLoadingCopy) {
    playLoadingCopy.textContent = message;
  }

  playLoading.hidden = !isVisible;
}

async function preloadImage(url) {
  if (!url) {
    throw new Error("Missing image URL.");
  }

  const loader = new Image();
  loader.decoding = "async";
  loader.loading = "eager";
  loader.src = url;

  if (loader.complete && loader.naturalWidth > 0) {
    return;
  }

  try {
    await loader.decode();
    return;
  } catch {
    await new Promise((resolve, reject) => {
      loader.addEventListener("load", resolve, { once: true });
      loader.addEventListener(
        "error",
        () => reject(new Error("Could not load image.")),
        { once: true },
      );
    });
  }
}

async function warmImageCache(url) {
  if (!url) {
    return;
  }

  try {
    await preloadImage(url);
  } catch {
    // Ignore background warmup errors and fall back to the normal round loader.
  }
}

function goToGameOver(payload) {
  const completedPayload = {
    ...payload,
    durationMs: Math.max(0, Date.now() - state.runStartedAt),
  };

  const params = new URLSearchParams({
    result: completedPayload.result,
    score: String(completedPayload.score),
    highScore: String(completedPayload.highScore),
    answer: completedPayload.answer || "",
    durationMs: String(completedPayload.durationMs),
  });

  window.setTimeout(() => {
    window.location.assign(`/game-over/?${params.toString()}`);
  }, GAME_OVER_DELAY_MS);
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveFatalApiError(result, matchText) {
  if (result.status !== "rejected") {
    return null;
  }

  const message = String(result.reason?.message || "");

  if (!message.toLowerCase().includes(matchText)) {
    return null;
  }

  return new Error(message);
}

function shuffleArray(values) {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}
