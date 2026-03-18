import { ensureAvatarIconAssets, drawAvatarIcon } from "/scripts/avatar-icon.js";
import { censorProfanity, requestJson, setStatus } from "/scripts/shared.js";
import { readAvatarSelectionFromSearchParams } from "/shared/avatar-selection.js";
import { searchInWordBank } from "/shared/word-bank.js";

const entryForm = document.querySelector("#online-entry-form");
const playerNameInput = document.querySelector("#online-player-name");
const joinMatchButton = document.querySelector("#join-match-button");
const createPrivateRoomButton = document.querySelector("#create-private-room-button");
const leaveMatchButton = document.querySelector("#leave-match-button");
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
const matchSection = document.querySelector("#online-match");
const summarySection = document.querySelector("#online-summary");
const scoreboard = document.querySelector("#online-scoreboard");
const roundLabel = document.querySelector("#online-round-label");
const timerLabel = document.querySelector("#online-timer-label");
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
const gameImage = document.querySelector("#online-game-image");
const imageLoading = document.querySelector("#online-image-loading");
const imageLoadingCopy = document.querySelector("#online-image-loading-copy");

const POLL_INTERVAL_QUEUED_MS = 2000;
const POLL_INTERVAL_WAITING_MS = 1000;
const POLL_INTERVAL_LIVE_MS = 1000;
const GUEST_NAME_MIN = 100000;
const GUEST_NAME_MAX = 999999;
const AUTO_JOIN_QUERY_KEY = "autoplay";
const CREATE_PRIVATE_ROOM_QUERY_KEY = "createPrivateRoom";
const ROOM_QUERY_KEY = "room";

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
};

bootstrap();

window.addEventListener("pagehide", () => {
  notifyServerAboutExit();
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted && hasActiveSession()) {
    void refreshState();
  }
});

entryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
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

async function bootstrap() {
  hydrateSessionFromUrl();
  void loadWordBank();
  void ensureAvatarIconAssets().catch(() => {});

  if (hasActiveSession()) {
    await refreshState();
    return;
  }

  if (state.shouldAutoJoin) {
    state.shouldAutoJoin = false;
    if (state.shouldAutoCreatePrivateRoom) {
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
  state.playerId = params.get("playerId") || "";
  state.token = params.get("token") || "";
  state.shouldAutoJoin = params.get(AUTO_JOIN_QUERY_KEY) === "1";
  state.shouldAutoCreatePrivateRoom = params.get(CREATE_PRIVATE_ROOM_QUERY_KEY) === "1";
  state.requestedRoomId = params.get(ROOM_QUERY_KEY) || "";

  if (playerNameInput) {
    playerNameInput.value = normalizeName(params.get("name") || "");
  }

  if (state.shouldAutoJoin) {
    const url = new URL(window.location.href);
    url.searchParams.delete(AUTO_JOIN_QUERY_KEY);
    url.searchParams.delete(CREATE_PRIVATE_ROOM_QUERY_KEY);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }
}

function syncSessionUrl() {
  const url = new URL(window.location.href);

  url.searchParams.delete(AUTO_JOIN_QUERY_KEY);
  url.searchParams.delete(CREATE_PRIVATE_ROOM_QUERY_KEY);

  if (state.requestedRoomId) {
    url.searchParams.set(ROOM_QUERY_KEY, state.requestedRoomId);
  } else {
    url.searchParams.delete(ROOM_QUERY_KEY);
  }

  if (state.playerId && state.token) {
    url.searchParams.set("playerId", state.playerId);
    url.searchParams.set("token", state.token);
  } else {
    url.searchParams.delete("playerId");
    url.searchParams.delete("token");
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function loadWordBank() {
  try {
    const payload = await requestJson("/api/word-bank");
    state.wordBank = Array.isArray(payload.words) ? payload.words : [];
  } catch {
    state.wordBank = [];
  }
}

async function joinMatch() {
  const playerName = ensurePlayerName();

  try {
    setBusy(true);
    setStatus(
      onlineStatus,
      state.requestedRoomId ? "Joining private room..." : "Finding another player...",
      "default",
    );

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
    setStatus(onlineStatus, "Creating your private room...", "default");

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

  const guess = normalizeGuessDisplay(guessInput?.value || "");

  if (!guess) {
    setStatus(onlineStatus, "Type a guess before sending it.", "warning");
    guessInput?.focus();
    return;
  }

  try {
    guessButton.disabled = true;
    setStatus(onlineStatus, "Sending guess...", "default");

    const payload = await requestJson("/api/online-duel-guess", {
      method: "POST",
      body: {
        playerId: state.playerId,
        token: state.token,
        guess,
      },
    });

    guessForm.reset();
    clearInlineSuggestion();
    renderPayload(payload);
  } catch (error) {
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
    clearSession();
    setBusy(false);
    renderIdle();
  }
}

function renderPayload(payload) {
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
  const { preserveStatus = false } = options;
  state.latestPayload = null;
  clearPoll();
  clearRoomTicker();
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
  guessInput.disabled = true;
  clearInlineSuggestion();
  populateRoomLink("");
  roomRoster?.replaceChildren();
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
  clearRoomTicker();
  lobbySection.hidden = true;
  queueSection.hidden = false;
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = false;
  leaveMatchButton.textContent = "Leave Queue";
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  setStatus(onlineStatus, "Searching for another player...", "default");
}

function renderWaitingRoom(room) {
  queueSection.hidden = true;
  lobbySection.hidden = false;
  matchSection.hidden = true;
  summarySection.hidden = true;
  leaveMatchButton.hidden = false;
  leaveMatchButton.textContent = room?.type === "private" ? "Leave Room" : "Leave Lobby";
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  playerNameInput.disabled = true;
  roomLinkRow.hidden = room?.type !== "private";
  startRoomButton.hidden = room?.type !== "private" || !room?.isHost;
  startRoomButton.disabled = !room?.canStart;

  if (room?.type === "private") {
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
  } else {
    populateRoomLink("");
    updateWaitingRoomSnapshot(room);
  }

  renderRoomRoster(room?.players || [], room?.hostId || "");
  startRoomTicker();
}

function renderLive(room) {
  lobbySection.hidden = true;
  queueSection.hidden = true;
  matchSection.hidden = false;
  summarySection.hidden = true;
  leaveMatchButton.hidden = false;
  leaveMatchButton.textContent = "Forfeit Match";
  joinMatchButton.hidden = true;
  createPrivateRoomButton.hidden = true;
  startRoomButton.hidden = true;
  playerNameInput.disabled = true;
  setStatus(
    onlineStatus,
    room?.type === "private"
      ? `Private room live with ${room?.playerCount || 0} players.`
      : room.opponent?.name
        ? `Live against ${room.opponent.name}.`
        : "Live match started.",
    "default",
  );
  renderRoom(room);
  startRoomTicker();
}

function renderFinished(room) {
  lobbySection.hidden = true;
  queueSection.hidden = true;
  matchSection.hidden = false;
  summarySection.hidden = false;
  leaveMatchButton.hidden = true;
  joinMatchButton.hidden = false;
  createPrivateRoomButton.hidden = false;
  startRoomButton.hidden = true;
  playerNameInput.disabled = false;
  setStatus(onlineStatus, "Match finished.", "default");
  renderRoom(room);
  updateSummary(room);
  clearRoomTicker();
}

function renderRoom(room) {
  if (!room) {
    return;
  }

  roundLabel.textContent = `Round ${Math.min(room.roundIndex, room.roundCount)} of ${room.roundCount}`;
  renderScoreboard(room.players || [], room.hostId || "");
  renderRoundHistory(room.completedRounds || []);
  renderGuessHistory(yourGuessList, room.currentRound?.youGuesses || [], "No guesses yet.");
  renderGuessHistory(
    roomGuessList,
    room.currentRound?.roomGuesses || [],
    "No room guesses yet.",
  );
  updateRoomSnapshot(room);
}

function updateRoomSnapshot(room = state.latestPayload?.room) {
  if (!room) {
    return;
  }

  const snapshot = deriveRoundSnapshot(room);
  timerLabel.textContent = snapshot.timerLabel;
  roundStatus.textContent = snapshot.statusText;
  updateImageStage(room.currentRound, snapshot.zoomScale, snapshot.overlayText);
  updateGuessFormAvailability(snapshot);
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

  roomTitle.textContent = "Public room";

  if (room.playerCount < 2) {
    roomCopy.textContent =
      "Waiting for one more player. The 10-second start timer begins as soon as player two joins.";
    setStatus(onlineStatus, "Waiting for another player to kick off the room.", "default");
    return;
  }

  roomCopy.textContent =
    room.playerCount >= room.maxPlayers
      ? `Room full. Starting in ${startsInSeconds}s.`
      : `Starting in ${startsInSeconds}s. Anyone else who joins before then is added to this room, up to ${room.maxPlayers}.`;
  setStatus(
    onlineStatus,
    `Public room filling up: ${room.playerCount}/${room.maxPlayers} players. Starts in ${startsInSeconds}s.`,
    "default",
  );
}

function deriveRoundSnapshot(room) {
  if (room.status === "waiting") {
    return {
      timerLabel: "Waiting for host",
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
      timerLabel: "Match finished",
      statusText: buildFinishedMessage(room),
      zoomScale: 1,
      overlayText: "",
      canGuess: false,
    };
  }

  const round = room.currentRound;

  if (!round) {
    return {
      timerLabel: "Waiting for round...",
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

    return {
      timerLabel:
        room.status === "finished"
          ? "Match finished"
          : remaining > 0
            ? `Next round in ${Math.ceil(remaining / 1000)}s`
            : "Loading next round...",
      statusText: buildResolvedRoundMessage(room),
      zoomScale: 1,
      overlayText: "",
      canGuess: false,
    };
  }

  if (Number.isFinite(startedAt) && now < startedAt) {
    return {
      timerLabel: `Round starts in ${Math.ceil((startedAt - now) / 1000)}s`,
      statusText:
        room.playerCount > 2
          ? "Everyone is locked in. Get ready."
          : "Both players are locked in. Get ready.",
      zoomScale: round.zoomLevels?.[0] || round.zoomScale || 1,
      overlayText: `Starting in ${Math.ceil((startedAt - now) / 1000)}s`,
      canGuess: false,
    };
  }

  const zoomLevels = Array.isArray(round.zoomLevels) && round.zoomLevels.length
    ? round.zoomLevels
    : [round.zoomScale || 1];
  const stepMs = Number(round.zoomStepMs || 15000);
  const roundDurationMs = Number(round.roundDurationMs || stepMs * zoomLevels.length);
  const elapsed = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
  const zoomIndex = Math.min(Math.floor(elapsed / stepMs), zoomLevels.length - 1);
  const nextZoomInMs =
    zoomIndex < zoomLevels.length - 1 ? Math.max(0, stepMs - (elapsed % stepMs)) : 0;
  const endsInMs = Math.max(0, roundDurationMs - elapsed);

  return {
    timerLabel:
      nextZoomInMs > 0
        ? `Next zoom in ${Math.ceil(nextZoomInMs / 1000)}s`
        : `Round ends in ${Math.ceil(endsInMs / 1000)}s`,
    statusText: "First correct guess wins the round.",
    zoomScale: zoomLevels[zoomIndex],
    overlayText: "",
    canGuess: true,
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
    showImageLoading("Loading round...");
    gameImage.src = round.imageUrl;
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
  showImageLoading("Waiting for round...");
}

gameImage?.addEventListener("load", () => {
  hideImageLoading();
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

function updateGuessFormAvailability(snapshot = deriveRoundSnapshot(state.latestPayload?.room || {})) {
  const canGuess = Boolean(snapshot?.canGuess && state.latestPayload?.status === "live");
  guessInput.disabled = !canGuess;
  guessButton.disabled = !canGuess;

  if (!canGuess) {
    clearInlineSuggestion();
    return;
  }

  updateAutocomplete();
}

function renderRoundHistory(rounds) {
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

function renderGuessHistory(container, guesses, emptyText) {
  container.replaceChildren();

  if (!guesses.length) {
    container.append(buildEmptyListItem(emptyText));
    return;
  }

  for (const entry of guesses) {
    const item = document.createElement("li");
    const displayGuess = censorProfanity(entry.guess, { maxLength: 80 });
    const guessPrefix = entry.playerName ? `${entry.playerName}: ` : "";
    item.textContent = entry.correct ? `${guessPrefix}${displayGuess} ✓` : `${guessPrefix}${displayGuess}`;
    if (entry.correct) {
      item.dataset.correct = "true";
    }
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

  players.forEach((player) => {
    const card = document.createElement("article");
    card.className = "play-online-player-card";

    if (player.isYou) {
      card.dataset.you = "true";
    }

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
    score.textContent = String(player.score || 0);

    card.append(identity, score);
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

  if (!round?.winnerId) {
    return `Nobody got this round. The answer was ${round?.answer || "unknown"}.`;
  }

  if (round.winnerId === room.you?.id) {
    return `You won the round with "${round.winningGuess}". The answer was ${round.answer}.`;
  }

  return `${round.winnerName || "Another player"} won the round with "${round.winningGuess}". The answer was ${round.answer}.`;
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

function clearSession() {
  state.playerId = "";
  state.token = "";
  state.latestPayload = null;
  syncSessionUrl();
}

function notifyServerAboutExit() {
  if (!hasActiveSession()) {
    return;
  }

  const payload = JSON.stringify({
    playerId: state.playerId,
    token: state.token,
  });

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
  if (guessInput.disabled) {
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
  const randomNumber =
    Math.floor(Math.random() * (GUEST_NAME_MAX - GUEST_NAME_MIN + 1)) + GUEST_NAME_MIN;
  return `guest_${randomNumber}`;
}

function normalizeGuessDisplay(value) {
  return censorProfanity(value, { maxLength: 80 });
}
