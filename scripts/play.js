import { restoreImageQueue } from "/scripts/image-queue.js";
import { censorProfanity, normalizeAnswer, requestJson, setStatus } from "/scripts/shared.js";
import { buildDemoImages } from "/shared/demo-images.js";
import {
  readAvatarSelectionFromSearchParams,
  writeAvatarSelectionToSearchParams,
} from "/shared/avatar-selection.js";
import { WORD_BANK, createWordBankIndex } from "/shared/word-bank.js";

const MAX_WRONG_GUESSES = 4;
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.45, 1];
const WRONG_GUESS_MESSAGES = [
  "Not quite. This one is easier if you've actually been on campus lately.",
  "Nope. Feels like a guess from someone who takes every class online.",
  "Wrong answer. You were confident, though.",
  "Not this time. A quick walk around campus might help.",
  "Close enough to submit, not close enough to be right.",
  "Nope. This might be a sign to leave the house more often.",
];

const guessMeter = document.querySelector("#guess-meter");
const streakMeter = document.querySelector("#streak-meter");
const feedback = document.querySelector("#feedback");
const image = document.querySelector("#game-image");

// Light deterrent: block right-click "open/save image" and drag-to-save so
// players can't trivially open the full picture in a new tab. Not real
// protection (the image is still in devtools/network), just stops casual peeking.
image?.addEventListener("contextmenu", (event) => event.preventDefault());
image?.addEventListener("dragstart", (event) => event.preventDefault());

const form = document.querySelector("#guess-form");
const input = document.querySelector("#guess-input");
const ghostTyped = document.querySelector("#ghost-typed");
const ghostSuffix = document.querySelector("#ghost-suffix");
const playLoading = document.querySelector("#play-loading");
const playLoadingCopy = document.querySelector("#play-loading-copy");
const GAME_OVER_DELAY_MS = 950;
const preferredPlayerName = loadPreferredPlayerName();
const preferredAvatarSelection = loadPreferredAvatarSelection();
let wordBank = [];
let wordBankIndex = createWordBankIndex([]);

const state = {
  images: [],
  current: null,
  imageQueue: null,
  runStartedAt: 0,
  wrongGuesses: 0,
  roundLocked: true,
  streak: 0,
  highScore: 0,
  inlineSuggestion: "",
  roundLoadToken: 0,
  wrongGuessMessageIndex: -1,
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

  if (event.key === "Escape") {
    clearInlineSuggestion();
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

  const displayedGuess = normalizeGuessDisplay(input.value);

  if (!displayedGuess) {
    setStatus(feedback, "Type a guess before submitting.", "warning");
    return;
  }

  const resolvedGuess = wordBankIndex.get(normalizeAnswer(displayedGuess)) || displayedGuess;

  input.value = censorProfanity(resolvedGuess, { maxLength: 80 });
  clearInlineSuggestion();

  const guess = normalizeAnswer(resolvedGuess);

  if (isCorrectGuess(guess, state.current)) {
    state.roundLocked = true;
    state.streak += 1;
    revealImage(false);
    updateStreakMeter();

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
  setStatus(feedback, getNextWrongGuessMessage(), "warning");
  input.select();
});

function startNewGame() {
  try {
    state.imageQueue = JSON.parse(localStorage.getItem("uwzoom.solo-image-queue"));
  } catch {
    state.imageQueue = null;
  }
  state.runStartedAt = Date.now();
  state.streak = 0;
  updateStreakMeter();
  return loadNextRound({ isFirstRound: true });
}

async function loadNextRound(options = {}) {
  state.imageQueue = restoreImageQueue(state.images, state.imageQueue);
  const nextId = state.imageQueue.remaining[0];
  const nextRound = state.images.find((entry) => entry.id === nextId);

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

  state.imageQueue.remaining.shift();
  state.imageQueue.seen.push(nextId);
  try {
    localStorage.setItem("uwzoom.solo-image-queue", JSON.stringify(state.imageQueue));
  } catch {
    // Storage may be unavailable; the in-memory queue still avoids repeats.
  }
  image.src = nextRound.imageUrl;
  image.alt = `Mystery image for ${nextRound.answer}`;
  state.startFocusX = 15 + Math.floor(Math.random() * 70);
  state.startFocusY = 15 + Math.floor(Math.random() * 70);
  updateZoom();
  state.roundLocked = false;
  input.disabled = false;
  input.focus();
  setPlayLoading(false);
  setStatus(feedback, "");
  void warmImageCache(state.images.find((entry) => entry.id === state.imageQueue.remaining[0])?.imageUrl);
}

function updateZoom() {
  const scale = ZOOM_LEVELS[Math.min(state.wrongGuesses, ZOOM_LEVELS.length - 1)];
  const maxZoom = ZOOM_LEVELS[0];
  const t = maxZoom <= 1 ? 1 : Math.max(0, Math.min(1, (maxZoom - scale) / (maxZoom - 1)));
  const endX = state.current?.focusX || 50;
  const endY = state.current?.focusY || 50;
  const currentX = (state.startFocusX || endX) + (endX - (state.startFocusX || endX)) * t;
  const currentY = (state.startFocusY || endY) + (endY - (state.startFocusY || endY)) * t;
  image.style.transformOrigin = `${currentX}% ${currentY}%`;
  image.style.transform = `scale(${scale})`;
  image.style.transition = "transform 0.6s ease-out, transform-origin 0.6s ease-out";
}

function revealImage(isGameOver) {
  if (isGameOver) {
    state.wrongGuesses = MAX_WRONG_GUESSES;
  }

  const endX = state.current?.focusX || 50;
  const endY = state.current?.focusY || 50;
  image.style.transformOrigin = `${endX}% ${endY}%`;
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
    clearInlineSuggestion();
    return;
  }

  const typedValue = input.value;
  const selectionStart = input.selectionStart ?? typedValue.length;
  const selectionEnd = input.selectionEnd ?? typedValue.length;
  const caretAtEnd = selectionStart === typedValue.length && selectionEnd === typedValue.length;

  if (!typedValue.trim() || !caretAtEnd) {
    clearInlineSuggestion();
    return;
  }

  const suggestion = findInlineSuggestion(typedValue);

  if (!suggestion || suggestion === typedValue) {
    clearInlineSuggestion();
    return;
  }

  state.inlineSuggestion = suggestion;
  renderGhostSuggestion(suggestion);
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

function acceptInlineSuggestion() {
  if (!hasInlineSuggestion()) {
    return;
  }

  input.value = state.inlineSuggestion;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  clearInlineSuggestion();
}

function renderGhostSuggestion(suggestion) {
  if (!ghostTyped || !ghostSuffix) {
    return;
  }

  const typedValue = input.value;
  ghostTyped.textContent = typedValue;
  ghostSuffix.textContent = resolveSuggestionSuffix(typedValue, suggestion);
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

function resolveSuggestionSuffix(typedValue, suggestion) {
  const normalizedTyped = String(typedValue || "");
  const normalizedSuggestion = String(suggestion || "");

  if (
    normalizedSuggestion.toLocaleLowerCase("en-CA").startsWith(
      normalizedTyped.toLocaleLowerCase("en-CA"),
    )
  ) {
    return normalizedSuggestion.slice(normalizedTyped.length);
  }

  return "";
}

function getNextWrongGuessMessage() {
  if (!WRONG_GUESS_MESSAGES.length) {
    return "Not quite.";
  }

  let nextIndex = Math.floor(Math.random() * WRONG_GUESS_MESSAGES.length);

  if (WRONG_GUESS_MESSAGES.length > 1) {
    while (nextIndex === state.wrongGuessMessageIndex) {
      nextIndex = Math.floor(Math.random() * WRONG_GUESS_MESSAGES.length);
    }
  }

  state.wrongGuessMessageIndex = nextIndex;
  return WRONG_GUESS_MESSAGES[nextIndex];
}

function normalizeGuessDisplay(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
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

  if (preferredPlayerName) {
    params.set("name", preferredPlayerName);
  }

  writeAvatarSelectionToSearchParams(params, preferredAvatarSelection);

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

function loadPreferredPlayerName() {
  const params = new URLSearchParams(window.location.search);

  return String(params.get("name") || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function loadPreferredAvatarSelection() {
  const params = new URLSearchParams(window.location.search);
  return readAvatarSelectionFromSearchParams(params);
}
