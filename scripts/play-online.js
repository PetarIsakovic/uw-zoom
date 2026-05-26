import { ensureAvatarIconAssets, drawAvatarIcon } from "/scripts/avatar-icon.js";
import {
  censorProfanity,
  clearPendingOnlineLeave,
  requestJson,
  setStatus,
  stashPendingOnlineLeave,
} from "/scripts/shared.js";
import { readAvatarSelectionFromSearchParams } from "/shared/avatar-selection.js";
import { searchInWordBank } from "/shared/word-bank.js";

const entryForm = document.querySelector("#online-entry-form");
const playerNameInput = document.querySelector("#online-player-name");
const joinMatchButton = document.querySelector("#join-match-button");
const createPrivateRoomButton = document.querySelector("#create-private-room-button");
const leaveMatchButton = document.querySelector("#leave-match-button");
const heroSection = document.querySelector("#online-hero");
const joinSection = document.querySelector("#online-join");
const onlineStatus = document.querySelector("#online-status");
const lobbySection = document.querySelector("#online-lobby");
const roomTitle = document.querySelector("#online-room-title");
const roomCopy = document.querySelector("#online-room-copy");
const roomLinkInput = document.querySelector("#online-room-link");
const copyRoomLinkButton = document.querySelector("#copy-room-link-button");
const roomLinkRow = document.querySelector("#online-room-link-row");
const startRoomButton = document.querySelector("#start-room-button");
const roomRoster = document.querySelector("#online-room-roster");
const queueSection = document.querySelector("#online-queue");
const queueTitle = document.querySelector("#online-queue-title");
const queueCopy = document.querySelector("#online-queue-copy");
const queuePlayersSection = document.querySelector("#online-queue-players");
const queuePlayersList = document.querySelector("#online-queue-players-list");
const matchSection = document.querySelector("#online-match");
const summarySection = document.querySelector("#online-summary");
const scoreboard = document.querySelector("#online-scoreboard");
const timerLabel = document.querySelector("#online-timer-label");
const timerContext = document.querySelector("#online-timer-context");
const clockTimer = document.querySelector(".play-online-clock-timer");
const roundStatus = document.querySelector("#online-round-status");
const roundHistory = document.querySelector("#online-round-history");
const yourGuessList = document.querySelector("#your-guess-list");
const roomGuessList = document.querySelector("#online-room-guess-list");
const guessForm = document.querySelector("#online-guess-form");
const guessInput = document.querySelector("#online-guess-input");
const ghostTyped = document.querySelector("#online-ghost-typed");
const ghostSuffix = document.querySelector("#online-ghost-suffix");
const guessButton = document.querySelector("#online-guess-button");
const summaryTitle = document.querySelector("#online-summary-title");
const summaryCopy = document.querySelector("#online-summary-copy");
const findAnotherMatchButton = document.querySelector("#find-another-match-button");
const settingsButton = document.querySelector("#online-settings-button");
const roundPopup = document.querySelector("#online-round-popup");
const roundPopupTitle = document.querySelector("#online-round-popup-title");
const roundPopupScores = document.querySelector("#online-round-popup-scores");
const settingsPopup = document.querySelector("#online-settings-popup");
const settingsClose = document.querySelector("#online-settings-close");
const settingsLeave = document.querySelector("#online-settings-leave");
const soundToggle = document.querySelector("#online-sound-toggle");
const volumeSlider = document.querySelector("#online-volume-slider");
const gameImage = document.querySelector("#online-game-image");
const imageLoading = document.querySelector("#online-image-loading");
const imageLoadingCopy = document.querySelector("#online-image-loading-copy");
const letterHintEl = document.querySelector("#online-letter-hint");
const lobbyCenterEl = document.querySelector("#online-lobby-center");
const stageEl = document.querySelector("#online-stage");
const guessLabel = document.querySelector("#online-guess-label");

const POLL_INTERVAL_QUEUED_MS = 2000;
const POLL_INTERVAL_WAITING_MS = 1000;
const POLL_INTERVAL_LIVE_MS = 1000;
const AUTO_JOIN_QUERY_KEY = "autoplay";
const CREATE_PRIVATE_ROOM_QUERY_KEY = "createPrivateRoom";
const ROOM_QUERY_KEY = "room";
const GENERATED_PLAYER_NAMES = [
  "Goose",
  "LinkedInWarrior",
  "QuestDweller",
  "DanaPorterGremlin",
  "LazeezEnjoyer",
  "WatCardWizard",
  "SLCWanderer",
  "MCBasementGoblin",
  "PACRunner",
  "CIFCamper",
  "CoopGoblin",
  "E7Lurker",
  "GooseWrangler",
  "MathSocMystery",
  "BomberNightOwl",
  "RCHRoamer",
  "IONDrifter",
  "UWPigeon",
];

const state = {
  playerId: "",
  token: "",
  shouldAutoJoin: false,
  shouldAutoCreatePrivateRoom: false,
  requestedRoomId: "",
  avatar: readAvatarSelectionFromSearchParams(new URLSearchParams(window.location.search)),
  wordBank: [],
  pollTimer: 0,
  roomTickTimer: 0,
  latestPayload: null,
  currentImageUrl: "",
  inlineSuggestion: "",
  exitCleanupSent: false,
  waitingForFirstImageReveal: false,
  hasRevealedLiveMatch: false,
  queueTitleBase: "",
  queueTitleAnimate: false,
  queueTitleTick: 0,
  queueTitleTimer: 0,
  pendingRoomGuesses: [],
  soundEnabled: true,
  volume: 80,
  soundInitialized: false,
  soundLastPlayerCount: 0,
  soundLastRoundNumber: null,
  soundLastResolvedAt: null,
  soundLastGuessCount: 0,
  soundLastChatCount: 0,
  soundLastTimerSeconds: null,
};

const SOUND_NAMES = ["join", "leave", "playerGuessed", "roundEndFailure", "roundEndSuccess", "roundStart", "tick"];

function loadSounds() {
  // Preload by creating throwaway Audio objects so files are cached by the browser
  for (const name of SOUND_NAMES) {
    const audio = new Audio(`/assets/sound-effects/${name}.ogg`);
    audio.preload = "auto";
  }
}

function playSound(name) {
  if (!state.soundEnabled) return;
  if (!SOUND_NAMES.includes(name)) return;
  const audio = new Audio(`/assets/sound-effects/${name}.ogg`);
  audio.volume = state.volume / 100;
  audio.play().catch(() => {});
}

function resetSoundTracking() {
  state.soundInitialized = false;
}

function detectAndPlaySounds(room, snapshot) {
  const round = room.currentRound;
  const roundNumber = round?.roundNumber ?? null;
  const resolvedAt = round?.resolvedAt ?? null;
  const playerCount = room.playerCount ?? 0;
  const allRoomGuesses = getVisibleRoomGuesses(room);
  const now = Date.now();
  const guessCount = allRoomGuesses.filter((g) => !g.isChat).length;
  const chatCount = allRoomGuesses.filter(
    (g) => g.isChat && g.playerId !== room.you?.id && now - Date.parse(g.at || "") >= BOT_CHAT_DELAY_MS,
  ).length;
  const timerSeconds = snapshot.timerCount ?? null;

  if (!state.soundInitialized) {
    state.soundLastPlayerCount = playerCount;
    state.soundLastRoundNumber = roundNumber;
    state.soundLastResolvedAt = resolvedAt;
    state.soundLastGuessCount = guessCount;
    state.soundLastChatCount = chatCount;
    state.soundLastTimerSeconds = timerSeconds;
    state.soundInitialized = true;
    return;
  }

  if (playerCount > state.soundLastPlayerCount) {
    playSound("join");
  }
  state.soundLastPlayerCount = playerCount;

  if (roundNumber !== null && roundNumber !== state.soundLastRoundNumber && !resolvedAt) {
    playSound("roundStart");
  }
  state.soundLastRoundNumber = roundNumber;

  if (resolvedAt && resolvedAt !== state.soundLastResolvedAt) {
    playSound(round?.winnerId ? "roundEndSuccess" : "roundEndFailure");
  }
  state.soundLastResolvedAt = resolvedAt;

  if (guessCount > state.soundLastGuessCount) {
    playSound("playerGuessed");
  }
  state.soundLastGuessCount = guessCount;

  if (chatCount > state.soundLastChatCount) {
    playSound("playerGuessed");
  }
  state.soundLastChatCount = chatCount;

  if (timerSeconds !== null && timerSeconds <= 5 && timerSeconds !== state.soundLastTimerSeconds) {
    playSound("tick");
  }
  state.soundLastTimerSeconds = timerSeconds;
}

// On the dedicated /play-online/ page, auto-bootstrap.
// On the landing page (SPA mode), wait for the start event.
if (document.body.classList.contains("play-online-page")) {
  bootstrap();
} else {
  document.addEventListener("uwzoom:start-play-online", () => {
    // Show the loading screen immediately — before play-online-root is ever revealed
    const startupLoading = document.getElementById("landing-startup-loading");
    const startupTitle = startupLoading?.querySelector(".landing-startup-title");
    if (startupTitle) startupTitle.textContent = "Finding a match...";
    if (startupLoading) startupLoading.removeAttribute("hidden");
    document.body.dataset.ready = "false";
    // play-online-root stays hidden until clearJoiningState() is called
    bootstrap();
  });
}

window.addEventListener("pagehide", () => {
  leaveSessionOnExit();
});

window.addEventListener("beforeunload", () => {
  leaveSessionOnExit();
});

// Auto-redirect keystrokes to the guess input when in-game
document.addEventListener("keydown", (e) => {
  if (!guessInput) return;
  if (document.activeElement === guessInput) return;
  // Only redirect printable characters, not modifier-only or control keys
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!document.body.classList.contains("play-online-in-game")) return;
  if (guessInput.dataset.canGuess !== "true") return;
  guessInput.focus();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) {
    return;
  }

  if (hasActiveSession()) {
    void refreshState();
    return;
  }

  renderIdle();
});

entryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  playSound("roundEndSuccess");
  await joinMatch();
});

createPrivateRoomButton?.addEventListener("click", async () => {
  await createPrivateRoom();
});

leaveMatchButton?.addEventListener("click", async () => {
  await leaveCurrentSession();
});

copyRoomLinkButton?.addEventListener("click", async () => {
  await copyRoomLink();
});

startRoomButton?.addEventListener("click", async () => {
  await startPrivateRoom();
});

guessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitGuess();
});

guessInput?.addEventListener("input", () => {
  updateAutocomplete();
});

guessInput?.addEventListener("focus", () => {
  updateAutocomplete();
});

guessInput?.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && hasInlineSuggestion()) {
    event.preventDefault();
    acceptInlineSuggestion();
    return;
  }

  if (event.key === "ArrowRight" && hasInlineSuggestion()) {
    const selectionStart = guessInput.selectionStart ?? 0;
    const selectionEnd = guessInput.selectionEnd ?? 0;
    const caretAtEnd =
      selectionStart === guessInput.value.length && selectionEnd === guessInput.value.length;

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

findAnotherMatchButton?.addEventListener("click", async () => {
  await joinMatch();
});

settingsButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !settingsPopup.hidden;
  settingsPopup.hidden = isOpen;
  settingsButton.setAttribute("aria-expanded", String(!isOpen));
});

settingsClose?.addEventListener("click", () => {
  settingsPopup.hidden = true;
  settingsButton?.setAttribute("aria-expanded", "false");
});

settingsLeave?.addEventListener("click", async () => {
  settingsPopup.hidden = true;
  settingsButton?.setAttribute("aria-expanded", "false");
  await leaveCurrentSession();
});

soundToggle?.addEventListener("change", () => {
  state.soundEnabled = soundToggle.checked;
  if (volumeSlider) {
    volumeSlider.disabled = !state.soundEnabled;
  }
});

volumeSlider?.addEventListener("input", () => {
  state.volume = Number(volumeSlider.value);
});

document.addEventListener("click", (event) => {
  if (settingsPopup && !settingsPopup.hidden && !settingsPopup.contains(event.target) && event.target !== settingsButton && !settingsButton?.contains(event.target)) {
    settingsPopup.hidden = true;
    settingsButton?.setAttribute("aria-expanded", "false");
  }
});

// In embedded/SPA mode, intercept "Home" and "Back Home" links to avoid page reload
if (!document.body.classList.contains("play-online-page")) {
  document.getElementById("play-online-root")?.addEventListener("click", (event) => {
    const link = event.target.closest("a[href='/']");
    if (link) {
      event.preventDefault();
      leaveCurrentSession();
    }
  });
}

async function bootstrap() {
  hydrateSessionFromUrl();
  void loadWordBank();
  void ensureAvatarIconAssets().catch(() => {});
  loadSounds();

  // When auto-joining (e.g. user clicked Play on landing), skip refreshState and go straight
  // to joinMatch — the join API will reuse or replace the existing session server-side.
  if (hasActiveSession() && !state.shouldAutoJoin && !state.requestedRoomId) {
    await refreshState();
    return;
  }

  if (state.shouldAutoJoin || state.requestedRoomId) {
    state.shouldAutoJoin = false;
    if (state.shouldAutoCreatePrivateRoom) {
      renderCreatingPrivateRoom();
      state.shouldAutoCreatePrivateRoom = false;
      await createPrivateRoom();
    } else {
      await joinMatch();
    }

    if (!hasActiveSession()) {
      renderIdle({ preserveStatus: true });
    }

    return;
  }

  renderIdle();
}

function hydrateSessionFromUrl() {
  const params = new URLSearchParams(window.location.search);

  let handoff = null;
  try {
    const raw = sessionStorage.getItem("uwzoom-play-handoff");
    if (raw) {
      handoff = JSON.parse(raw);
      sessionStorage.removeItem("uwzoom-play-handoff");
    }
  } catch {}

  state.playerId = params.get("playerId") || sessionStorage.getItem("uwzoom-player-id") || "";
  state.token = params.get("token") || sessionStorage.getItem("uwzoom-player-token") || "";
  state.shouldAutoJoin = Boolean(handoff?.autoplay) || params.get(AUTO_JOIN_QUERY_KEY) === "1";
  state.shouldAutoCreatePrivateRoom =
    Boolean(handoff?.createPrivateRoom) || params.get(CREATE_PRIVATE_ROOM_QUERY_KEY) === "1";
  state.requestedRoomId = params.get(ROOM_QUERY_KEY) || "";

  if (handoff?.avatar) {
    state.avatar = handoff.avatar;
  }

  if (playerNameInput) {
    playerNameInput.value = normalizeName(handoff?.name || params.get("name") || "");
  }

  const roomId = params.get(ROOM_QUERY_KEY) || "";
  window.history.replaceState({}, "", roomId ? `/?room=${roomId}` : "/");
}

function syncSessionUrl() {
  const url = new URL(window.location.href);

  // Strip all session/handoff params from URL — state lives in sessionStorage
  for (const key of ["autoplay", "createPrivateRoom", "playerId", "token", "name",
                      "avatarBody", "avatarEyes", "avatarMouth", "avatarExtra"]) {
    url.searchParams.delete(key);
  }

  if (state.requestedRoomId) {
    url.searchParams.set(ROOM_QUERY_KEY, state.requestedRoomId);
  } else {
    url.searchParams.delete(ROOM_QUERY_KEY);
  }

  try {
    if (state.playerId && state.token) {
      sessionStorage.setItem("uwzoom-player-id", state.playerId);
      sessionStorage.setItem("uwzoom-player-token", state.token);
    } else {
      sessionStorage.removeItem("uwzoom-player-id");
      sessionStorage.removeItem("uwzoom-player-token");
    }
  } catch {}

  // Keep the URL clean — always show "/" (or "/?room=..." for shareable private rooms)
  const roomParam = url.searchParams.get(ROOM_QUERY_KEY);
  window.history.replaceState({}, "", roomParam ? `/?room=${roomParam}` : "/");
}

async function loadWordBank() {
  try {
    const payload = await requestJson("/api/word-bank");
    state.wordBank = Array.isArray(payload.words) ? payload.words : [];
  } catch {
    state.wordBank = [];
  }
}

function renderJoining() {
  playerNameInput.disabled = true;

  if (!document.body.classList.contains("play-online-page")) {
    // SPA mode: loading screen already shown by the uwzoom:start-play-online event listener
    return;
  }

  // Standalone play-online page fallback
  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = false;
  queueSection.classList.add("play-online-queue-joining");
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
}

async function joinMatch() {
  const playerName = ensurePlayerName();

  renderJoining();

  try {
    setBusy(true);
    state.exitCleanupSent = false;
    clearPendingOnlineLeave();

    const payload = await requestJson("/api/online-duel-join", {
      method: "POST",
      body: {
        name: playerName,
        avatar: state.avatar,
        playerId: state.playerId || undefined,
        token: state.token || undefined,
        roomId: state.requestedRoomId || undefined,
      },
    });

    state.playerId = payload.playerId || "";
    state.token = payload.token || "";
    if (payload.room?.type === "private") {
      state.requestedRoomId = payload.room.id || state.requestedRoomId;
    }
    syncSessionUrl();
    renderPayload(payload);
  } catch (error) {
    setStatus(onlineStatus, error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function createPrivateRoom() {
  const playerName = ensurePlayerName();

  try {
    setBusy(true);
    createPrivateRoomButton.textContent = "Creating...";
    state.exitCleanupSent = false;
    clearPendingOnlineLeave();

    const payload = await requestJson("/api/online-duel-create-room", {
      method: "POST",
      body: {
        name: playerName,
        avatar: state.avatar,
        playerId: state.playerId || undefined,
        token: state.token || undefined,
      },
    });

    state.playerId = payload.playerId || "";
    state.token = payload.token || "";
    state.requestedRoomId = payload.room?.id || "";
    syncSessionUrl();
    renderPayload(payload);
  } catch (error) {
    setStatus(onlineStatus, error.message, "error");
    createPrivateRoomButton.textContent = "Create Private Room";
  } finally {
    setBusy(false);
  }
}

async function startPrivateRoom() {
  if (!hasActiveSession()) {
    return;
  }

  try {
    setBusy(true);
    setStatus(onlineStatus, "Starting the room...", "default");

    const payload = await requestJson("/api/online-duel-start", {
      method: "POST",
      body: {
        playerId: state.playerId,
        token: state.token,
      },
    });

    renderPayload(payload);
  } catch (error) {
    setStatus(onlineStatus, error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshState() {
  if (!hasActiveSession()) {
    renderIdle();
    return;
  }

  try {
    const payload = await requestJson(
      `/api/online-duel-room?playerId=${encodeURIComponent(state.playerId)}&token=${encodeURIComponent(state.token)}`,
    );

    renderPayload(payload);
  } catch (error) {
    clearSession();
    renderIdle();
    setStatus(onlineStatus, error.message, "error");
  }
}

async function submitGuess() {
  if (!hasActiveSession()) {
    setStatus(onlineStatus, "Join a match before sending guesses.", "warning");
    return;
  }

  if (guessInput?.dataset.canGuess !== "true") {
    return;
  }

  const rawGuess = String(guessInput?.value || "").trim().slice(0, 80);
  const displayGuess = normalizeGuessDisplay(rawGuess);

  if (!rawGuess) {
    setStatus(onlineStatus, "Type a guess before sending it.", "warning");
    guessInput?.focus();
    return;
  }

  const pendingEntry = createPendingRoomGuess(displayGuess);

  try {
    pushPendingRoomGuess(pendingEntry);
    guessForm.reset();
    guessButton.disabled = true;
    clearInlineSuggestion();
    rerenderActiveRoom();
    setStatus(onlineStatus, "Sending guess...", "default");

    const payload = await requestJson("/api/online-duel-guess", {
      method: "POST",
      body: {
        playerId: state.playerId,
        token: state.token,
        guess: rawGuess,
      },
    });

    removePendingRoomGuess(pendingEntry.localId);
    renderPayload(payload);
  } catch (error) {
    removePendingRoomGuess(pendingEntry.localId);
    rerenderActiveRoom();
    guessInput.value = rawGuess;
    updateAutocomplete();
    guessInput.focus();
    guessInput.setSelectionRange(guessInput.value.length, guessInput.value.length);
    setStatus(onlineStatus, error.message, "error");
  } finally {
    updateGuessFormAvailability();
  }
}

async function leaveCurrentSession() {
  if (!hasActiveSession()) {
    renderIdle();
    return;
  }

  playSound("leave");

  try {
    setBusy(true);
    await requestJson("/api/online-duel-leave", {
      method: "POST",
      body: {
        playerId: state.playerId,
        token: state.token,
      },
    });
  } catch {
    // Best effort. We still clear the local session so the page can recover.
  } finally {
    clearPendingOnlineLeave();
    clearSession();
    setBusy(false);
    renderIdle();
  }
}

function clearJoiningState() {
  queueSection.classList.remove("play-online-queue-joining");
  // Restore play-online-root and hide landing-root if we used it for the joining screen
  if (!document.body.classList.contains("play-online-page")) {
    // Hide all sections before revealing play-online-root to avoid any flash
    heroSection.hidden = true;
    document.getElementById("landing-root")?.setAttribute("hidden", "");
    document.getElementById("play-online-root")?.removeAttribute("hidden");
    document.body.dataset.ready = "true";
  }
}

function renderPayload(payload) {
  clearInitialIntroSkip();
  clearJoiningState();
  state.latestPayload = payload;

  if (payload.room?.you?.name) {
    playerNameInput.value = payload.room.you.name;
  }

  if (payload.name) {
    playerNameInput.value = payload.name;
  }

  if (payload.room?.type === "private") {
    state.requestedRoomId = payload.room.id || state.requestedRoomId;
  } else if (payload.status !== "queued") {
    state.requestedRoomId = "";
  }

  syncSessionUrl();

  if (payload.status === "queued") {
    renderQueued();
    schedulePoll(POLL_INTERVAL_QUEUED_MS);
    return;
  }

  if (payload.status === "waiting") {
    renderWaitingRoom(payload.room);
    schedulePoll(POLL_INTERVAL_WAITING_MS);
    return;
  }

  if (payload.status === "live") {
    renderLive(payload.room);
    schedulePoll(POLL_INTERVAL_LIVE_MS);
    return;
  }

  if (payload.status === "finished") {
    renderFinished(payload.room);
    clearPoll();
    return;
  }

  renderIdle();
}

function renderIdle(options = {}) {
  document.body.classList.remove("play-online-in-game");
  document.body.classList.remove("play-online-in-lobby");
  clearInitialIntroSkip();
  clearJoiningState();
  state.latestPayload = null;
  clearPoll();
  clearRoomTicker();
  stopQueueTitleAnimation();

  // In SPA/embedded mode on the landing page, just return to the landing UI
  if (!document.body.classList.contains("play-online-page")) {
    document.getElementById("play-online-root")?.setAttribute("hidden", "");
    document.getElementById("landing-root")?.removeAttribute("hidden");
    return;
  }

  const { preserveStatus = false } = options;
  heroSection.hidden = false;
  joinSection.hidden = false;
  lobbySection.hidden = true;
  queueSection.hidden = true;
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = false;
  createPrivateRoomButton.hidden = false;
  startRoomButton.hidden = true;
  roomLinkRow.hidden = true;
  playerNameInput.disabled = false;
  guessButton.disabled = true;
  clearInlineSuggestion();
  populateRoomLink("");
  roomRoster?.replaceChildren();
  clearQueuePlayers();
  scoreboard?.replaceChildren();

  if (!preserveStatus) {
    setStatus(
      onlineStatus,
      "Queue into a public room or create a private room of your own.",
      "default",
    );
  }

  resetImageStage();
}

function renderQueued() {
  resetSoundTracking();
  clearRoomTicker();
  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = false;
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = false;
  const selfPlayer = {
    id: state.playerId,
    name: playerNameInput?.value?.trim() || "You",
    avatar: state.avatar,
    isYou: true,
  };
  renderQueuePlayers([selfPlayer], state.playerId);
  updateQueueCopy("Finding a match...", "Looking for another player right now.");
}

function renderCreatingPrivateRoom() {
  clearRoomTicker();
  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = true;
  matchSection.hidden = false;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  roomLinkRow.hidden = false;
  if (lobbyCenterEl) lobbyCenterEl.hidden = false;
  if (stageEl) stageEl.hidden = true;
  document.body.classList.add("play-online-in-game");
  document.body.classList.add("play-online-in-lobby");
  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = false;
  stopQueueTitleAnimation();
  roomTitle.textContent = "Creating your private room";
  roomCopy.textContent = "Generating the invite link. You will be able to share it in a moment.";
  populateRoomLink("Generating invite link...");
  roomRoster?.replaceChildren();
  if (roomRoster) roomRoster.hidden = false;
  scoreboard.hidden = true;
  clearQueuePlayers();
  if (guessLabel) guessLabel.textContent = "Say something";
  if (guessInput) guessInput.placeholder = "Chat with your friends...";
  setStatus(onlineStatus, "Creating your private room...", "default");
}

function renderWaitingRoom(room) {
  if (room?.type !== "private") {
    renderPublicWaitingRoom(room);
    return;
  }

  heroSection.hidden = true;
  joinSection.hidden = true;
  queueSection.hidden = true;
  lobbySection.hidden = true;
  matchSection.hidden = false;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  playerNameInput.disabled = true;
  roomLinkRow.hidden = false;
  startRoomButton.hidden = !room?.isHost;
  startRoomButton.disabled = !room?.canStart;
  if (lobbyCenterEl) lobbyCenterEl.hidden = false;
  if (stageEl) stageEl.hidden = true;
  document.body.classList.add("play-online-in-game");
  document.body.classList.add("play-online-in-lobby");
  if (roomRoster) roomRoster.hidden = false;
  scoreboard.hidden = true;
  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = false;
  clearQueuePlayers();
  if (guessLabel) guessLabel.textContent = "Say something";
  if (guessInput) guessInput.placeholder = "Chat with your friends...";

  roomTitle.textContent = room?.isHost ? "Your private room" : `${room?.hostName || "Private"} room`;
  roomCopy.textContent = room?.canStart
    ? "Everyone is here. Start the game whenever you want."
    : room?.isHost
      ? `Share the link below. Up to ${room?.maxPlayers || 8} players can join.`
      : `Waiting for ${room?.hostName || "the host"} to start the game.`;

  populateRoomLink(room?.shareUrl || "");
  setStatus(
    onlineStatus,
    room?.isHost
      ? "Invite players with the room link, then click Start Game."
      : `Joined ${room?.hostName || "the host"}'s private room.`,
    "default",
  );

  renderRoomRoster(room?.players || [], room?.hostId || "");
  if (room) renderRoom(room);
  startRoomTicker();
}

function renderLive(room) {
  document.body.classList.add("play-online-in-game");
  document.body.classList.remove("play-online-in-lobby");
  if (clockTimer) clockTimer.hidden = false;
  stopQueueTitleAnimation();
  const showSingleLoadingScreen = !state.hasRevealedLiveMatch && shouldHoldLiveReveal(room);

  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = !showSingleLoadingScreen;
  matchSection.hidden = showSingleLoadingScreen;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  if (lobbyCenterEl) lobbyCenterEl.hidden = true;
  if (stageEl) stageEl.hidden = false;
  if (roomRoster) roomRoster.hidden = true;
  scoreboard.hidden = false;
  if (guessLabel) guessLabel.textContent = "Your guess";
  if (guessInput) guessInput.placeholder = "WatCard, Dana Porter, goose...";
  clearQueuePlayers();
  setStatus(
    onlineStatus,
    room?.type === "private"
      ? `Private room live with ${room?.playerCount || 0} players.`
      : room?.playerCount > 2
        ? `Live public room with ${room.playerCount} players.`
        : room.opponent?.name
        ? `Live against ${room.opponent.name}.`
        : "Live match started.",
    "default",
  );
  renderRoom(room);
  syncLiveScreen(room);
  if (!showSingleLoadingScreen) {
    state.hasRevealedLiveMatch = true;
  }
  startRoomTicker();
}

function renderFinished(room) {
  document.body.classList.remove("play-online-in-game");
  document.body.classList.remove("play-online-in-lobby");
  if (roundPopup) roundPopup.hidden = true;
  if (clockTimer) clockTimer.hidden = true;
  resetSoundTracking();
  stopQueueTitleAnimation();
  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = true;
  matchSection.hidden = false;
  summarySection.hidden = false;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = false;
  createPrivateRoomButton.hidden = false;
  startRoomButton.hidden = true;
  playerNameInput.disabled = false;
  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = false;
  clearQueuePlayers();
  setStatus(onlineStatus, "Match finished.", "default");
  renderRoom(room);
  updateSummary(room);
  clearRoomTicker();
}

function renderRoom(room) {
  if (!room) {
    return;
  }

  renderScoreboard(room.players || [], room.hostId || "");
  renderRoundHistory(room.completedRounds || []);
  renderGuessHistory(yourGuessList, room.currentRound?.youGuesses || [], "No guesses yet.");
  renderGuessHistory(
    roomGuessList,
    getVisibleRoomGuesses(room),
    "No room guesses yet.",
  );
  updateRoomSnapshot(room);
}

function updateRoomSnapshot(room = state.latestPayload?.room) {
  if (!room) {
    return;
  }

  const snapshot = deriveRoundSnapshot(room);
  timerLabel.textContent = snapshot.timerCount !== null ? String(snapshot.timerCount) : "";
  if (timerContext) timerContext.textContent = snapshot.timerContext;
  roundStatus.textContent = snapshot.statusText;
  updateImageStage(room.currentRound, snapshot.zoomScale, snapshot.overlayText);
  updateGuessFormAvailability(snapshot);
  detectAndPlaySounds(room, snapshot);
  if (letterHintEl) {
    const hint = room.currentRound?.letterHint || "";
    letterHintEl.textContent = hint;
    letterHintEl.hidden = !hint;
  }

  if (roundPopup) {
    roundPopup.hidden = !snapshot.isIntermission;
    if (snapshot.isIntermission) {
      if (roundPopupTitle) roundPopupTitle.textContent = buildResolvedRoundMessage(room);
      if (roundPopupScores) {
        const scores = (room.players || [])
          .slice()
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .map((p) => `${p.name}: ${p.score || 0} pt${p.score === 1 ? "" : "s"}`)
          .join("  ·  ");
        roundPopupScores.textContent = scores;
      }
    }
  }

  if (room.status === "live") {
    syncLiveScreen(room, snapshot);
  }
}

function updateWaitingRoomSnapshot(room = state.latestPayload?.room) {
  if (!room || room.status !== "waiting") {
    return;
  }

  if (room.type === "private") {
    return;
  }

  const startsInMs = resolveWaitingCountdownMs(room);
  const startsInSeconds = Math.max(1, Math.ceil(startsInMs / 1000));

  if (room.playerCount < 2) {
    updateQueueCopy(
      "Finding a match...",
      "Waiting for one more player. The 10-second start timer begins as soon as player two joins.",
    );
    setStatus(onlineStatus, "Waiting for another player to kick off the room.", "default");
    return;
  }

  updateQueueCopy(
    "Match found",
    room.playerCount >= room.maxPlayers
      ? `Room full. Starting in ${startsInSeconds}s.`
      : `Starting in ${startsInSeconds}s. Anyone else who joins before then is added to this room, up to ${room.maxPlayers}.`,
  );
  setStatus(
    onlineStatus,
    `Public room filling up: ${room.playerCount}/${room.maxPlayers} players. Starts in ${startsInSeconds}s.`,
    "default",
  );
}

function deriveRoundSnapshot(room) {
  if (room.status === "waiting") {
    return {
      timerCount: null,
      timerContext: "Waiting for host",
      statusText: room.isHost
        ? "Start the room whenever everyone is ready."
        : `Waiting for ${room.hostName || "the host"} to start the game.`,
      zoomScale: 1,
      overlayText: "Waiting for host...",
      canGuess: false,
    };
  }

  if (room.status === "finished") {
    return {
      timerCount: null,
      timerContext: "Match finished",
      statusText: buildFinishedMessage(room),
      zoomScale: 1,
      overlayText: "",
      canGuess: false,
    };
  }

  const round = room.currentRound;

  if (!round) {
    return {
      timerCount: null,
      timerContext: "Waiting...",
      statusText: "The match is getting the next round ready.",
      zoomScale: 1,
      overlayText: "Waiting for round...",
      canGuess: false,
    };
  }

  const now = Date.now();
  const startedAt = Date.parse(round.startedAt || "");
  const resolvedAt = Date.parse(round.resolvedAt || "");

  if (Number.isFinite(resolvedAt)) {
    const remaining = Math.max(0, resolvedAt + (round.intermissionMs || 0) - now);
    const isFinished = room.status === "finished";

    return {
      timerCount: !isFinished && remaining > 0 ? Math.ceil(remaining / 1000) : null,
      timerContext: isFinished ? "Match finished" : remaining > 0 ? "Next round in" : "Loading...",
      statusText: buildResolvedRoundMessage(room),
      zoomScale: 1,
      overlayText: "",
      canGuess: false,
      isIntermission: !isFinished && remaining > 0,
    };
  }

  if (Number.isFinite(startedAt) && now < startedAt) {
    const secsUntilStart = Math.ceil((startedAt - now) / 1000);
    return {
      timerCount: secsUntilStart,
      timerContext: "Get ready",
      statusText:
        room.playerCount > 2
          ? "Everyone is locked in. Get ready."
          : "Both players are locked in. Get ready.",
      zoomScale: round.zoomLevels?.[0] || round.zoomScale || 1,
      overlayText: `Starting in ${secsUntilStart}s`,
      canGuess: false,
    };
  }

  const zoomLevels = Array.isArray(round.zoomLevels) && round.zoomLevels.length
    ? round.zoomLevels
    : [round.zoomScale || 1];
  const stepDurations = Array.isArray(round.zoomStepDurationsMs) && round.zoomStepDurationsMs.length === zoomLevels.length
    ? round.zoomStepDurationsMs
    : zoomLevels.map(() => Number(round.zoomStepMs || 30000));
  const roundDurationMs = Number(round.roundDurationMs || stepDurations.reduce((s, d) => s + d, 0));
  const elapsed = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;

  // Variable-duration zoom step calculation
  let zoomIndex = zoomLevels.length - 1;
  let cumulative = 0;
  for (let i = 0; i < stepDurations.length; i++) {
    cumulative += stepDurations[i];
    if (elapsed < cumulative) { zoomIndex = i; break; }
  }
  const nextStepAt = stepDurations.slice(0, zoomIndex + 1).reduce((s, d) => s + d, 0);
  const nextZoomInMs = zoomIndex < zoomLevels.length - 1 ? Math.max(0, nextStepAt - elapsed) : 0;
  const endsInMs = Math.max(0, roundDurationMs - elapsed);

  const alreadyCorrect = (room.currentRound?.youGuesses || []).some((g) => g.correct);

  return {
    timerCount: Math.ceil(endsInMs / 1000),
    timerContext: nextZoomInMs > 0 ? "Next zoom in" : "Round ends in",
    statusText: alreadyCorrect ? "Correct! Waiting for other players..." : "",
    zoomScale: zoomLevels[zoomIndex],
    overlayText: "",
    canGuess: !alreadyCorrect,
  };
}

function updateImageStage(round, zoomScale, overlayText) {
  if (!round?.imageUrl) {
    showImageLoading(overlayText || "Waiting for round...");
    gameImage.removeAttribute("src");
    state.currentImageUrl = "";
    return;
  }

  if (state.currentImageUrl !== round.imageUrl) {
    state.currentImageUrl = round.imageUrl;
    gameImage.src = round.imageUrl;
    // Only show loading overlay if image isn't cached/loaded already
    if (!gameImage.complete || !gameImage.naturalWidth) {
      hideImageLoading();
    }
  }

  gameImage.style.transformOrigin = `${round.focusX || 50}% ${round.focusY || 50}%`;
  gameImage.style.transform = `scale(${zoomScale || 1})`;

  if (overlayText) {
    showImageLoading(overlayText);
    return;
  }

  if (gameImage.complete && gameImage.naturalWidth > 0) {
    hideImageLoading();
  }
}

function resetImageStage() {
  state.currentImageUrl = "";
  gameImage.removeAttribute("src");
  hideImageLoading();
}

gameImage?.addEventListener("load", () => {
  hideImageLoading();
  maybeRevealLiveMatch();
});

gameImage?.addEventListener("error", () => {
  showImageLoading("Image failed to load. Refresh and try again.");
  setStatus(onlineStatus, "That round image could not load.", "error");
});

function showImageLoading(message) {
  imageLoading.hidden = false;
  imageLoadingCopy.textContent = message;
}

function hideImageLoading() {
  imageLoading.hidden = true;
}

function renderPublicWaitingRoom(room) {
  clearRoomTicker();
  heroSection.hidden = true;
  joinSection.hidden = true;
  lobbySection.hidden = true;
  queueSection.hidden = false;
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = false;
  populateRoomLink("");
  renderQueuePlayers(room?.players || [], room?.hostId || "");
  updateWaitingRoomSnapshot(room);
  startRoomTicker();
}

function shouldHoldLiveReveal(_room) {
  return false;
}

function syncLiveScreen(room, snapshot = deriveRoundSnapshot(room)) {
  if (state.hasRevealedLiveMatch) {
    state.waitingForFirstImageReveal = false;
    queueSection.hidden = true;
    matchSection.hidden = false;
    return;
  }

  const shouldHold = shouldHoldLiveReveal(room);
  state.waitingForFirstImageReveal = shouldHold;
  queueSection.hidden = !shouldHold;
  matchSection.hidden = shouldHold;

  if (shouldHold) {
    updateQueueCopy(
      "Loading first image...",
      snapshot?.timerContext ? `${snapshot.timerContext}. Getting the round ready.` : "Getting the round ready.",
    );
  }
}

function maybeRevealLiveMatch() {
  const room = state.latestPayload?.room;

  if (!state.waitingForFirstImageReveal || state.latestPayload?.status !== "live" || !room) {
    return;
  }

  if (shouldHoldLiveReveal(room)) {
    return;
  }

  state.waitingForFirstImageReveal = false;
  state.hasRevealedLiveMatch = true;
  queueSection.hidden = true;
  matchSection.hidden = false;
}

function updateQueueCopy(title, copy) {
  setQueueTitle(title);

  if (queueCopy) {
    queueCopy.textContent = copy;
  }
}

function setQueueTitle(title) {
  if (!queueTitle) {
    return;
  }

  const normalizedTitle = String(title || "").trim();
  const shouldAnimate = normalizedTitle.toLowerCase() === "finding a match...";

  if (!shouldAnimate) {
    stopQueueTitleAnimation();
    queueTitle.textContent = normalizedTitle;
    return;
  }

  state.queueTitleBase = normalizedTitle.replace(/\.+$/, "");
  state.queueTitleAnimate = true;
  state.queueTitleTick = 0;
  queueTitle.textContent = state.queueTitleBase;

  if (state.queueTitleTimer) {
    return;
  }

  state.queueTitleTimer = window.setInterval(() => {
    if (!state.queueTitleAnimate || !queueTitle) {
      stopQueueTitleAnimation();
      return;
    }

    state.queueTitleTick = (state.queueTitleTick + 1) % 4;
    queueTitle.textContent = `${state.queueTitleBase}${".".repeat(state.queueTitleTick)}`;
  }, 420);
}

function stopQueueTitleAnimation() {
  state.queueTitleAnimate = false;
  state.queueTitleBase = "";
  state.queueTitleTick = 0;

  if (state.queueTitleTimer) {
    window.clearInterval(state.queueTitleTimer);
    state.queueTitleTimer = 0;
  }
}

function updateGuessFormAvailability(snapshot = deriveRoundSnapshot(state.latestPayload?.room || {})) {
  const isWaiting = state.latestPayload?.status === "waiting";
  const isLive = state.latestPayload?.status === "live";
  const canGuess = Boolean(snapshot?.canGuess && isLive);
  const canChat = (isWaiting && document.body.classList.contains("play-online-in-lobby")) ||
    (isLive && !canGuess);
  guessInput.disabled = false;
  guessButton.disabled = !canGuess && !canChat;
  guessInput.dataset.canGuess = (canGuess || canChat) ? "true" : "false";

  if (!canGuess) {
    clearInlineSuggestion();
    if (canChat && guessInput) {
      guessInput.placeholder = "Type a message...";
    }
    return;
  }

  if (guessInput) {
    guessInput.placeholder = "WatCard, Dana Porter, goose...";
  }
  updateAutocomplete();
}

function renderRoundHistory(rounds) {
  if (!roundHistory) {
    return;
  }

  roundHistory.replaceChildren();

  if (!rounds.length) {
    roundHistory.append(buildEmptyListItem("No rounds finished yet."));
    return;
  }

  for (const round of rounds) {
    const item = document.createElement("li");
    const winnerLabel =
      round.winnerName ||
      (round.reason === "timeout" ? "Draw" : "Unresolved");
    item.textContent = `Round ${round.roundNumber}: ${winnerLabel} — ${round.answer}`;
    roundHistory.append(item);
  }
}

const BOT_CHAT_DELAY_MS = 3500;

function renderGuessHistory(container, guesses, emptyText) {
  if (!container) {
    return;
  }

  // Filter out bot chat messages that haven't "arrived" yet — creates a natural delay
  const now = Date.now();
  const visible = guesses.filter((entry) => {
    if (!entry.isChat) return true;
    return now - Date.parse(entry.at || "") >= BOT_CHAT_DELAY_MS;
  });

  container.replaceChildren();

  if (!visible.length) {
    container.append(buildEmptyListItem(emptyText));
    return;
  }

  for (const entry of visible) {
    const item = document.createElement("li");
    item.className = "play-online-chat-message";
    const displayGuess = censorProfanity(entry.guess, { maxLength: 80 });
    const speaker = document.createElement("strong");
    speaker.className = "play-online-chat-speaker";
    speaker.textContent = entry.playerName || "Player";

    const body = document.createElement("span");
    body.className = "play-online-chat-body";
    if (entry.correct && entry.points > 0) {
      body.textContent = `${displayGuess} ✓ (+${entry.points} pts)`;
    } else if (entry.correct) {
      body.textContent = `${displayGuess} ✓`;
    } else {
      body.textContent = displayGuess;
    }

    if (entry.correct) {
      item.dataset.correct = "true";
    }
    if (entry.isChat) {
      item.dataset.chat = "true";
    }
    if (entry.pending) {
      item.dataset.pending = "true";
    }
    item.append(speaker, body);
    container.append(item);
  }
}

function renderScoreboard(players, hostId) {
  if (!scoreboard) {
    return;
  }

  scoreboard.replaceChildren();

  if (!players.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  players.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = "play-online-player-card";

    if (player.isYou) {
      card.dataset.you = "true";
    }

    if (index === 0) {
      card.dataset.leading = "true";
    }

    const rank = document.createElement("span");
    rank.className = "play-online-player-rank";
    rank.textContent = `#${index + 1}`;

    const identity = document.createElement("div");
    identity.className = "play-online-player-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "play-online-player-avatar";
    avatar.width = 40;
    avatar.height = 40;
    drawAvatarIcon(avatar, player.avatar);

    const copy = document.createElement("div");
    copy.className = "play-online-player-copy";

    const label = document.createElement("span");
    label.className = "play-online-player-label";
    label.textContent = player.isYou ? "You" : hostId === player.id ? "Host" : "Player";

    const name = document.createElement("strong");
    name.className = "play-online-player-name";
    name.textContent = player.name || "Player";

    copy.append(label, name);
    identity.append(avatar, copy);

    const score = document.createElement("span");
    score.className = "play-online-player-score";
    score.textContent = `${player.score || 0} pts`;

    card.append(rank, identity, score);
    fragment.append(card);
  });

  scoreboard.append(fragment);
}

function renderRoomRoster(players, hostId) {
  if (!roomRoster) {
    return;
  }

  roomRoster.replaceChildren();

  if (!players.length) {
    roomRoster.append(buildEmptyListItem("Nobody has joined yet."));
    return;
  }

  const fragment = document.createDocumentFragment();

  players.forEach((player) => {
    const item = document.createElement("li");
    item.className = "play-online-room-roster-item";

    const identity = document.createElement("div");
    identity.className = "play-online-room-roster-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "play-online-room-roster-avatar";
    avatar.width = 36;
    avatar.height = 36;
    drawAvatarIcon(avatar, player.avatar);

    const name = document.createElement("strong");
    name.className = "play-online-room-roster-name";
    name.textContent = player.name || "Player";

    identity.append(avatar, name);

    const meta = document.createElement("div");
    meta.className = "play-online-room-roster-meta";

    if (hostId === player.id) {
      const hostBadge = document.createElement("span");
      hostBadge.className = "play-online-room-roster-badge";
      hostBadge.textContent = "Host";
      meta.append(hostBadge);
    }

    if (player.isYou) {
      const youBadge = document.createElement("span");
      youBadge.className = "play-online-room-roster-badge";
      youBadge.textContent = "You";
      meta.append(youBadge);
    }

    item.append(identity, meta);
    fragment.append(item);
  });

  roomRoster.append(fragment);
}

function renderQueuePlayers(players, hostId) {
  if (!queuePlayersSection || !queuePlayersList) {
    return;
  }

  queuePlayersList.replaceChildren();

  if (!players.length) {
    queuePlayersSection.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();

  players.forEach((player) => {
    const item = document.createElement("li");
    item.className = "play-online-queue-player";

    const avatar = document.createElement("canvas");
    avatar.className = "play-online-queue-player-avatar";
    avatar.width = 36;
    avatar.height = 36;
    drawAvatarIcon(avatar, player.avatar);

    const copy = document.createElement("div");
    copy.className = "play-online-queue-player-copy";

    const name = document.createElement("strong");
    name.className = "play-online-queue-player-name";
    name.textContent = player.name || "Player";
    copy.append(name);

    const meta = [];

    if (hostId === player.id) {
      meta.push("Host");
    }

    if (player.isYou) {
      meta.push("You");
    }

    if (meta.length) {
      const metaText = document.createElement("span");
      metaText.className = "play-online-queue-player-meta";
      metaText.textContent = meta.join(" • ");
      copy.append(metaText);
    }

    item.append(avatar, copy);
    fragment.append(item);
  });

  queuePlayersList.append(fragment);
  queuePlayersSection.hidden = false;
}

function clearQueuePlayers() {
  queuePlayersList?.replaceChildren();

  if (queuePlayersSection) {
    queuePlayersSection.hidden = true;
  }
}

function populateRoomLink(value) {
  if (roomLinkInput) {
    roomLinkInput.value = value || "";
  }
}

async function copyRoomLink() {
  const link = roomLinkInput?.value?.trim();

  if (!link) {
    setStatus(onlineStatus, "Create or join a private room before copying its link.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    setStatus(onlineStatus, "Private room link copied.", "success");
  } catch {
    setStatus(onlineStatus, "Could not copy the room link on this browser.", "error");
  }
}

function buildEmptyListItem(text) {
  const item = document.createElement("li");
  item.className = "play-online-empty-item";
  item.textContent = text;
  return item;
}

function updateSummary(room) {
  summaryTitle.textContent = buildSummaryTitle(room);
  summaryCopy.textContent = buildFinishedMessage(room);
}

function buildSummaryTitle(room) {
  if (room.winnerId === room.you?.id) {
    return "You won the match";
  }

  if (room.winnerId && room.winnerName) {
    return `${room.winnerName} won the match`;
  }

  return "The match ended in a draw";
}

function buildFinishedMessage(room) {
  if (room.winnerId === room.you?.id) {
    return room.playerCount > 2
      ? `You finished on top with ${room.you?.score || 0} point${room.you?.score === 1 ? "" : "s"}.`
      : `You beat ${room.opponent?.name || "your opponent"} ${room.you?.score || 0}-${room.opponent?.score || 0}.`;
  }

  if (room.winnerId && room.winnerName) {
    if (room.playerCount > 2) {
      return `${room.winnerName} finished on top with ${resolvePlayerScore(room, room.winnerId)} points.`;
    }

    return `${room.winnerName} beat you ${resolvePlayerScore(room, room.winnerId)}-${room.you?.score || 0}.`;
  }

  return room.playerCount > 2
    ? "The room finished in a tie."
    : `You and ${room.opponent?.name || "your opponent"} finished tied.`;
}

function resolvePlayerScore(room, playerId) {
  const player = Array.isArray(room.players) ? room.players.find((entry) => entry.id === playerId) : null;
  return player?.score || 0;
}

function buildResolvedRoundMessage(room) {
  const round = room.currentRound;
  const answer = round?.answer || "unknown";

  if (!round?.winnerId) {
    return `Round over. Nobody guessed it. The answer was ${answer}.`;
  }

  if (round.winnerId === room.you?.id) {
    return `Round over! You were first with "${round.winningGuess}". The answer was ${answer}.`;
  }

  return `Round over! ${round.winnerName || "Another player"} was first. The answer was ${answer}.`;
}

function startRoomTicker() {
  clearRoomTicker();
  state.roomTickTimer = window.setInterval(() => {
    const room = state.latestPayload?.room;

    if (room?.status === "waiting") {
      updateWaitingRoomSnapshot(room);
      return;
    }

    updateRoomSnapshot(room);
  }, 500);
}

function clearRoomTicker() {
  window.clearInterval(state.roomTickTimer);
  state.roomTickTimer = 0;
}

function schedulePoll(delayMs) {
  clearPoll();
  state.pollTimer = window.setTimeout(() => {
    void refreshState();
  }, delayMs);
}

function clearPoll() {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = 0;
}

function resolveWaitingCountdownMs(room) {
  const startsAtMs = Date.parse(room?.lobbyStartsAt || "");

  if (!Number.isFinite(startsAtMs)) {
    return 0;
  }

  return Math.max(0, startsAtMs - Date.now());
}

function setBusy(isBusy) {
  joinMatchButton.disabled = isBusy;
  createPrivateRoomButton.disabled = isBusy;
  leaveMatchButton.disabled = isBusy;
  startRoomButton.disabled = isBusy || Boolean(state.latestPayload?.room && !state.latestPayload.room.canStart);
  copyRoomLinkButton.disabled = isBusy;
}

function hasActiveSession() {
  return Boolean(state.playerId && state.token);
}

function clearInitialIntroSkip() {
  document.documentElement.classList.remove("play-online-skip-intro");
}

function clearSession(options = {}) {
  const { preserveExitCleanupSent = false } = options;
  state.playerId = "";
  state.token = "";
  state.latestPayload = null;
  state.pendingRoomGuesses = [];
  if (!preserveExitCleanupSent) {
    state.exitCleanupSent = false;
  }
  syncSessionUrl();
}

function leaveSessionOnExit() {
  if (!hasActiveSession() || state.exitCleanupSent) {
    return;
  }

  state.exitCleanupSent = true;

  const playerId = state.playerId;
  const token = state.token;
  stashPendingOnlineLeave({ playerId, token });
  clearSession({ preserveExitCleanupSent: true });
  notifyServerAboutExit({ playerId, token });
}

function notifyServerAboutExit(session) {
  const playerId = String(session?.playerId || "").trim();
  const token = String(session?.token || "").trim();

  if (!playerId || !token) {
    return;
  }

  const payload = JSON.stringify({ playerId, token });

  const didSendBeacon =
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function" &&
    navigator.sendBeacon(
      "/api/online-duel-leave",
      new Blob([payload], {
        type: "application/json",
      }),
    );

  if (didSendBeacon) {
    return;
  }

  void fetch("/api/online-duel-leave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function updateAutocomplete() {
  if (guessInput.dataset.canGuess !== "true") {
    clearInlineSuggestion();
    return;
  }

  const typedValue = guessInput.value;
  const selectionStart = guessInput.selectionStart ?? typedValue.length;
  const selectionEnd = guessInput.selectionEnd ?? typedValue.length;
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
  const suggestions = searchInWordBank(state.wordBank, query, 1);
  return suggestions[0] || "";
}

function acceptInlineSuggestion() {
  if (!hasInlineSuggestion()) {
    return;
  }

  guessInput.value = state.inlineSuggestion;
  guessInput.focus();
  guessInput.setSelectionRange(guessInput.value.length, guessInput.value.length);
  clearInlineSuggestion();
}

function renderGhostSuggestion(suggestion) {
  if (!ghostTyped || !ghostSuffix) {
    return;
  }

  const typedValue = guessInput.value;
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

function normalizeName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function ensurePlayerName() {
  const currentName = normalizeName(playerNameInput?.value || "");

  if (currentName) {
    if (playerNameInput) {
      playerNameInput.value = currentName;
    }

    return currentName;
  }

  const guestName = createGuestName();

  if (playerNameInput) {
    playerNameInput.value = guestName;
  }

  return guestName;
}

function createGuestName() {
  return GENERATED_PLAYER_NAMES[Math.floor(Math.random() * GENERATED_PLAYER_NAMES.length)];
}

function normalizeGuessDisplay(value) {
  return censorProfanity(value, { maxLength: 80 });
}

function createPendingRoomGuess(guess) {
  const room = state.latestPayload?.room;

  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId: room?.id || "",
    roundIndex: Number(room?.roundIndex || 0),
    playerId: state.playerId,
    playerName: room?.you?.name || normalizeName(playerNameInput?.value || "") || "You",
    guess,
    correct: false,
    pending: true,
    at: new Date().toISOString(),
  };
}

function pushPendingRoomGuess(entry) {
  state.pendingRoomGuesses = [...state.pendingRoomGuesses, entry];
}

function removePendingRoomGuess(localId) {
  state.pendingRoomGuesses = state.pendingRoomGuesses.filter((entry) => entry.localId !== localId);
}

function getVisibleRoomGuesses(room) {
  const serverGuesses = Array.isArray(room?.currentRound?.roomGuesses) ? room.currentRound.roomGuesses : [];
  const pendingGuesses = state.pendingRoomGuesses.filter((entry) => {
    return entry.roomId === room?.id && entry.roundIndex === Number(room?.roundIndex || 0);
  });

  if (!pendingGuesses.length) {
    return serverGuesses;
  }

  const mergedGuesses = [...serverGuesses];

  pendingGuesses.forEach((pendingEntry) => {
    const alreadyPresent = serverGuesses.some((entry) => {
      return entry.playerName === pendingEntry.playerName && entry.guess === pendingEntry.guess;
    });

    if (!alreadyPresent) {
      mergedGuesses.push(pendingEntry);
    }
  });

  mergedGuesses.sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0));
  return mergedGuesses;
}

function rerenderActiveRoom() {
  if (state.latestPayload?.room) {
    renderRoom(state.latestPayload.room);
  }
}
