import { normalizeAnswer, requestJson, setStatus } from "/scripts/shared.js";

const MAX_WRONG_GUESSES = 4;
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.45, 1];

const roundStatus = document.querySelector("#round-status");
const guessMeter = document.querySelector("#guess-meter");
const feedback = document.querySelector("#feedback");
const image = document.querySelector("#game-image");
const form = document.querySelector("#guess-form");
const input = document.querySelector("#guess-input");
const nextButton = document.querySelector("#next-button");

const state = {
  images: [],
  current: null,
  previousId: null,
  wrongGuesses: 0,
  roundLocked: true,
};

init();

async function init() {
  try {
    const payload = await requestJson("/api/approved-images");
    state.images = Array.isArray(payload.images) ? payload.images : [];

    if (!state.images.length) {
      throw new Error("No approved images are available yet.");
    }

    startRound();
  } catch (error) {
    form.hidden = true;
    setStatus(feedback, error.message, "error");
    roundStatus.textContent = "No images";
    guessMeter.textContent = "Waiting";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (state.roundLocked || !state.current) {
    return;
  }

  const guess = normalizeAnswer(input.value);

  if (!guess) {
    setStatus(feedback, "Type a guess before submitting.", "warning");
    return;
  }

  if (isCorrectGuess(guess, state.current)) {
    state.roundLocked = true;
    revealImage();
    setStatus(feedback, `Correct. It was ${state.current.answer}.`, "success");
    roundStatus.textContent = "Solved";
    guessMeter.textContent = `${state.wrongGuesses} wrong`;
    nextButton.hidden = false;
    return;
  }

  state.wrongGuesses += 1;

  if (state.wrongGuesses >= MAX_WRONG_GUESSES) {
    state.roundLocked = true;
    revealImage();
    setStatus(
      feedback,
      `Out of guesses. The answer was ${state.current.answer}.`,
      "error",
    );
    roundStatus.textContent = "Revealed";
    guessMeter.textContent = "0 guesses left";
    nextButton.hidden = false;
    return;
  }

  updateZoom();
  updateGuessMeter();
  setStatus(feedback, "Not quite. The image just zoomed out a little more.", "warning");
  input.select();
});

nextButton.addEventListener("click", () => {
  startRound();
});

function startRound() {
  state.current = pickImage();
  state.previousId = state.current.id;
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
  roundStatus.textContent = state.current.source === "demo" ? "Demo round" : "Approved round";
  updateGuessMeter();
  setStatus(feedback, "Guess what the image is before the fourth miss reveals everything.");
}

function pickImage() {
  if (state.images.length === 1) {
    return state.images[0];
  }

  const candidates = state.images.filter((item) => item.id !== state.previousId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function updateZoom() {
  const scale = ZOOM_LEVELS[Math.min(state.wrongGuesses, ZOOM_LEVELS.length - 1)];
  image.style.transform = `scale(${scale})`;
}

function revealImage() {
  state.wrongGuesses = MAX_WRONG_GUESSES;
  image.style.transform = "scale(1)";
  input.disabled = true;
}

function updateGuessMeter() {
  const guessesLeft = Math.max(0, MAX_WRONG_GUESSES - state.wrongGuesses);
  guessMeter.textContent = `${guessesLeft} guess${guessesLeft === 1 ? "" : "es"} left`;
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
