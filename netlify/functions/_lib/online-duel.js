import { randomUUID } from "node:crypto";
import { normalizeAvatarSelection } from "./avatar-selection.js";
import { censorProfanity } from "./censor.js";
import { HttpError } from "./http.js";
import { listPlayableCatalogImages } from "./image-catalog.js";
import { deleteObject, getJson, listJson, putJson, storageConfigured } from "./storage.js";

const ONLINE_QUEUE_PREFIX = "app/online-duel/queue";
const ONLINE_PLAYER_PREFIX = "app/online-duel/players";
const ONLINE_ROOM_PREFIX = "app/online-duel/rooms";
const ONLINE_WINS_KEY = "app/online-duel/wins.json";

const ROOM_TYPE_PUBLIC = "public";
const ROOM_TYPE_PRIVATE = "private";
const ROOM_STATUS_WAITING = "waiting";
const ROOM_STATUS_LIVE = "live";
const ROOM_STATUS_FINISHED = "finished";

const PUBLIC_ROOM_MIN_PLAYERS = 2;
const PUBLIC_ROOM_MAX_PLAYERS = 8;
const PRIVATE_ROOM_MAX_PLAYERS = 8;
const PUBLIC_LOBBY_COUNTDOWN_MS = 10 * 1000;
const QUEUE_STALE_MS = 2 * 60 * 1000;
const QUEUE_HEARTBEAT_MS = 30 * 1000;
const ROUND_COUNT = 3;
const ROUND_COUNTDOWN_MS = 3000;
const ROUND_INTERMISSION_MS = 3500;
const ROUND_STEP_MS = 15 * 1000;
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.45, 1];
const ROUND_DURATION_MS = ROUND_STEP_MS * ZOOM_LEVELS.length;
const RECENT_GUESSES_LIMIT = 6;
const ROOM_GUESS_FEED_LIMIT = 16;
const MIN_GUESS_GAP_MS = 700;

export async function createPrivateOnlineDuelRoom({ origin, name, playerId, token, avatar }) {
  requireOnlineStorage();

  const session = normalizeSession({ name, playerId, token, avatar }, { requireName: true });
  const existing = await getExistingPlayerState(origin, session);

  if (existing.status === ROOM_STATUS_WAITING || existing.status === ROOM_STATUS_LIVE) {
    return {
      ...existing,
      playerId: session.playerId,
      token: session.token,
    };
  }

  if (existing.status === "queued") {
    await deleteObject(queueEntryKey(session.playerId)).catch(() => {});
  }

  if (existing.status === ROOM_STATUS_FINISHED) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
  }

  const room = await createRoom(origin, [session], {
    type: ROOM_TYPE_PRIVATE,
    status: ROOM_STATUS_WAITING,
    maxPlayers: PRIVATE_ROOM_MAX_PLAYERS,
    hostId: session.playerId,
  });

  await Promise.all([
    putJson(roomKey(room.id), room),
    putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(room, session)),
  ]);

  return {
    status: room.status,
    playerId: session.playerId,
    token: session.token,
    room: buildPublicRoomState(room, session.playerId, origin),
  };
}

export async function joinOnlineDuel({ origin, name, playerId, token, avatar, roomId }) {
  requireOnlineStorage();

  const session = normalizeSession({ name, playerId, token, avatar }, { requireName: true });
  const requestedRoomId = normalizeId(roomId);
  const existing = await getExistingPlayerState(origin, session);

  if (requestedRoomId) {
    if (existing.status === ROOM_STATUS_WAITING || existing.status === ROOM_STATUS_LIVE) {
      if (existing.room?.id === requestedRoomId) {
        return {
          ...existing,
          playerId: session.playerId,
          token: session.token,
        };
      }

      throw new HttpError(409, "Leave your current room before joining another one.");
    }

    if (existing.status === "queued") {
      await deleteObject(queueEntryKey(session.playerId)).catch(() => {});
    }

    if (existing.status === ROOM_STATUS_FINISHED) {
      await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
    }

    const room = await joinPrivateRoom(origin, requestedRoomId, session);

    return {
      status: room.status,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  if (
    existing.status === ROOM_STATUS_LIVE ||
    existing.status === ROOM_STATUS_WAITING ||
    existing.status === "queued"
  ) {
    return {
      ...existing,
      playerId: session.playerId,
      token: session.token,
    };
  }

  if (existing.status === ROOM_STATUS_FINISHED) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
  }

  const joinablePublicRoom = await findJoinablePublicRoom(origin, session.playerId);

  if (joinablePublicRoom) {
    const room = await joinPublicRoom(origin, joinablePublicRoom.id, session);

    return {
      status: room.status,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  const queueEntries = await loadActiveQueueEntries();
  const opponent = queueEntries.find((entry) => entry.playerId !== session.playerId);

  if (opponent) {
    const room = await createRoom(origin, [opponent, session], {
      type: ROOM_TYPE_PUBLIC,
      status: ROOM_STATUS_WAITING,
      maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
      hostId: opponent.playerId,
      lobbyStartsAt: new Date(Date.now() + PUBLIC_LOBBY_COUNTDOWN_MS).toISOString(),
    });

    await Promise.all([
      putJson(roomKey(room.id), room),
      putJson(playerAssignmentKey(opponent.playerId), buildPlayerAssignment(room, opponent)),
      putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(room, session)),
      deleteObject(queueEntryKey(opponent.playerId)).catch(() => {}),
      deleteObject(queueEntryKey(session.playerId)).catch(() => {}),
    ]);

    return {
      status: ROOM_STATUS_WAITING,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  const queuedAt = new Date().toISOString();

  await putJson(queueEntryKey(session.playerId), {
    playerId: session.playerId,
    token: session.token,
    name: session.name,
    avatar: session.avatar,
    joinedAt: queuedAt,
    updatedAt: queuedAt,
  });

  return {
    status: "queued",
    playerId: session.playerId,
    token: session.token,
    queuedAt,
  };
}

export async function startPrivateOnlineDuelRoom({ origin, playerId, token }) {
  requireOnlineStorage();

  const session = normalizeSession({ playerId, token }, { requireName: false });
  const room = await loadRoomForPlayer(origin, session);

  if (room.type !== ROOM_TYPE_PRIVATE) {
    throw new HttpError(400, "Only private rooms can be started manually.");
  }

  if (room.status !== ROOM_STATUS_WAITING) {
    throw new HttpError(409, "That room has already started.");
  }

  if (room.hostId !== session.playerId) {
    throw new HttpError(403, "Only the room host can start the game.");
  }

  if (room.players.length < 2) {
    throw new HttpError(409, "Private rooms need at least 2 players before the host can start.");
  }

  const now = Date.now();
  room.status = ROOM_STATUS_LIVE;
  room.currentRoundIndex = 0;
  room.currentRoundStartedAt = new Date(now + ROUND_COUNTDOWN_MS).toISOString();
  room.currentRoundResolvedAt = "";
  room.currentRoundWinnerId = "";
  room.currentRoundWinningGuess = "";
  room.currentRoundGuesses = {};
  room.completedRounds = [];
  room.finishedAt = "";
  room.winnerId = "";
  room.endedReason = "";
  room.winsRecordedAt = "";
  room.updatedAt = new Date(now).toISOString();
  room.scores = Object.fromEntries(room.players.map((player) => [player.id, normalizeScore(room.scores[player.id])]));

  await persistRoom(room);

  return {
    status: room.status,
    playerId: session.playerId,
    token: session.token,
    room: buildPublicRoomState(room, session.playerId, origin),
  };
}

export async function getOnlineDuelState({ origin, playerId, token }) {
  requireOnlineStorage();

  const session = normalizeSession({ playerId, token }, { requireName: false });
  const state = await getExistingPlayerState(origin, session);

  return {
    ...state,
    playerId: session.playerId,
    token: session.token,
  };
}

export async function submitOnlineDuelGuess({ origin, playerId, token, guess }) {
  requireOnlineStorage();

  const session = normalizeSession({ playerId, token }, { requireName: false });
  const room = await loadRoomForPlayer(origin, session);
  const now = Date.now();

  if (room.status === ROOM_STATUS_WAITING) {
    throw new HttpError(409, "The host has not started this room yet.");
  }

  if (room.status === ROOM_STATUS_FINISHED) {
    return {
      status: ROOM_STATUS_FINISHED,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  if (room.currentRoundResolvedAt) {
    return {
      status: ROOM_STATUS_LIVE,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  const currentRound = room.rounds[room.currentRoundIndex];
  const normalizedGuess = normalizeGuess(guess);

  if (!normalizedGuess) {
    throw new HttpError(400, "Type a guess before submitting.");
  }

  const playerGuesses = Array.isArray(room.currentRoundGuesses?.[session.playerId])
    ? room.currentRoundGuesses[session.playerId]
    : [];
  const lastGuessAt = Date.parse(playerGuesses.at(-1)?.at || "");

  if (Number.isFinite(lastGuessAt) && now - lastGuessAt < MIN_GUESS_GAP_MS) {
    throw new HttpError(429, "Slow down a bit before sending another guess.", {
      "Retry-After": "1",
    });
  }

  const canonicalGuess = normalizeGuessDisplay(guess);
  const correct = isCorrectGuess(normalizedGuess, currentRound);

  room.currentRoundGuesses = {
    ...room.currentRoundGuesses,
    [session.playerId]: trimGuessHistory([
      ...playerGuesses,
      {
        guess: canonicalGuess,
        correct,
        at: new Date(now).toISOString(),
      },
    ]),
  };

  if (correct) {
    resolveCurrentRound(room, {
      winnerId: session.playerId,
      winningGuess: canonicalGuess,
      resolvedAt: now,
      reason: "guess",
    });
  }

  const syncedRoom = await syncRoom(room);
  await persistRoom(syncedRoom);

  return {
    status: syncedRoom.status,
    playerId: session.playerId,
    token: session.token,
    room: buildPublicRoomState(syncedRoom, session.playerId, origin),
  };
}

export async function leaveOnlineDuel({ origin, playerId, token }) {
  requireOnlineStorage();

  const session = normalizeSession({ playerId, token }, { requireName: false });
  const existingState = await getExistingPlayerState(origin, session);

  if (existingState.status === "queued") {
    await deleteObject(queueEntryKey(session.playerId)).catch(() => {});
    return {
      success: true,
      status: "idle",
    };
  }

  if (
    existingState.status !== ROOM_STATUS_WAITING &&
    existingState.status !== ROOM_STATUS_LIVE &&
    existingState.status !== ROOM_STATUS_FINISHED
  ) {
    return {
      success: true,
      status: "idle",
    };
  }

  const room = await loadRoomForPlayer(origin, session);
  await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});

  if (room.type === ROOM_TYPE_PRIVATE) {
    const nextRoom = await removePlayerFromPrivateRoom(room, session.playerId);

    if (!nextRoom) {
      await deleteObject(roomKey(room.id)).catch(() => {});
      return {
        success: true,
        status: "idle",
      };
    }

    await persistRoom(nextRoom);

    return {
      success: true,
      status: "idle",
    };
  }

  if (room.status === ROOM_STATUS_WAITING) {
    const nextRoom = await removePlayerFromPublicWaitingRoom(room, session.playerId);

    if (!nextRoom) {
      await deleteObject(roomKey(room.id)).catch(() => {});
      return {
        success: true,
        status: "idle",
      };
    }

    await persistRoom(nextRoom);

    return {
      success: true,
      status: "idle",
    };
  }

  const opponent = room.players.find((player) => player.id !== session.playerId) || null;

  if (room.status !== ROOM_STATUS_FINISHED && opponent) {
    room.players = room.players.filter((player) => player.id !== session.playerId);
    delete room.scores[session.playerId];
    delete room.currentRoundGuesses[session.playerId];
    room.status = ROOM_STATUS_FINISHED;
    room.finishedAt = new Date().toISOString();
    room.winnerId = opponent.id;
    room.endedReason = "forfeit";
    room.updatedAt = room.finishedAt;
    await finalizeRoom(room);
    await persistRoom(room);
  }

  return {
    success: true,
    status: "idle",
  };
}

function requireOnlineStorage() {
  if (!storageConfigured()) {
    throw new HttpError(503, "Online mode needs AWS storage before it can run.");
  }
}

async function getExistingPlayerState(origin, session) {
  const roomState = await tryLoadAssignedRoom(origin, session);

  if (roomState) {
    return roomState;
  }

  const queueEntry = await getJson(queueEntryKey(session.playerId));

  if (queueEntry && queueEntry.token === session.token) {
    if (isTimestampFresh(queueEntry.updatedAt, QUEUE_STALE_MS)) {
      await refreshQueueHeartbeat(queueEntry, session);

      const joinablePublicRoom = await findJoinablePublicRoom(origin, session.playerId);

      if (joinablePublicRoom) {
        const room = await joinPublicRoom(origin, joinablePublicRoom.id, {
          playerId: session.playerId,
          token: session.token,
          name: normalizeName(queueEntry.name || session.name),
          avatar: normalizeAvatarSelection(queueEntry.avatar || session.avatar),
        });

        await deleteObject(queueEntryKey(session.playerId)).catch(() => {});

        return {
          status: room.status,
          room: buildPublicRoomState(room, session.playerId, origin),
        };
      }

      return {
        status: "queued",
        queuedAt: queueEntry.joinedAt,
        name: normalizeName(queueEntry.name),
      };
    }

    await deleteObject(queueEntryKey(session.playerId)).catch(() => {});
  }

  return {
    status: "idle",
  };
}

async function tryLoadAssignedRoom(origin, session) {
  const assignment = await getJson(playerAssignmentKey(session.playerId));

  if (!assignment) {
    return null;
  }

  if (assignment.token !== session.token) {
    throw new HttpError(401, "That online session is not valid anymore.");
  }

  const room = await getJson(roomKey(assignment.roomId));

  if (!room) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
    return null;
  }

  const syncedRoom = await syncRoom(room);

  if (didRoomChange(room, syncedRoom)) {
    await persistRoom(syncedRoom);
  }

  return {
    status: syncedRoom.status,
    room: buildPublicRoomState(syncedRoom, session.playerId, origin),
  };
}

async function loadRoomForPlayer(origin, session) {
  const assignment = await getJson(playerAssignmentKey(session.playerId));

  if (!assignment || assignment.token !== session.token) {
    throw new HttpError(404, "That online match could not be found.");
  }

  const room = await getJson(roomKey(assignment.roomId));

  if (!room) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
    throw new HttpError(404, "That online match could not be found.");
  }

  const syncedRoom = await syncRoom(room);

  if (didRoomChange(room, syncedRoom)) {
    await persistRoom(syncedRoom);
  }

  validatePlayerToken(syncedRoom, session.playerId, session.token);
  return syncedRoom;
}

async function joinPrivateRoom(origin, roomId, session) {
  const room = normalizeRoom(await getJson(roomKey(roomId)));

  if (!room?.id || room.type !== ROOM_TYPE_PRIVATE) {
    throw new HttpError(404, "That private room could not be found.");
  }

  if (room.status === ROOM_STATUS_FINISHED) {
    throw new HttpError(409, "That private room has already finished.");
  }

  if (room.status === ROOM_STATUS_LIVE) {
    throw new HttpError(409, "That private room has already started.");
  }

  const existingPlayer = room.players.find((player) => player.id === session.playerId);

  if (existingPlayer) {
    existingPlayer.token = session.token;
    existingPlayer.name = session.name;
    existingPlayer.avatar = normalizeAvatarSelection(session.avatar);
    existingPlayer.joinedAt = existingPlayer.joinedAt || new Date().toISOString();
    room.updatedAt = new Date().toISOString();
    await Promise.all([
      persistRoom(room),
      putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(room, session)),
    ]);
    return room;
  }

  if (room.players.length >= room.maxPlayers) {
    throw new HttpError(409, "That private room is already full.");
  }

  room.players.push({
    id: session.playerId,
    token: session.token,
    name: session.name,
    avatar: normalizeAvatarSelection(session.avatar),
    joinedAt: new Date().toISOString(),
  });
  room.scores = {
    ...room.scores,
    [session.playerId]: 0,
  };
  room.updatedAt = new Date().toISOString();

  await Promise.all([
    persistRoom(room),
    putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(room, session)),
  ]);

  return room;
}

async function joinPublicRoom(origin, roomId, session) {
  const room = normalizeRoom(await getJson(roomKey(roomId)));

  if (!room?.id || room.type !== ROOM_TYPE_PUBLIC) {
    throw new HttpError(404, "That public room could not be found.");
  }

  const syncedRoom = await syncRoom(room);

  if (didRoomChange(room, syncedRoom)) {
    await persistRoom(syncedRoom);
  }

  if (syncedRoom.status !== ROOM_STATUS_WAITING) {
    throw new HttpError(409, "That public room has already started.");
  }

  const existingPlayer = syncedRoom.players.find((player) => player.id === session.playerId);

  if (existingPlayer) {
    existingPlayer.token = session.token;
    existingPlayer.name = session.name;
    existingPlayer.avatar = normalizeAvatarSelection(session.avatar);
    existingPlayer.joinedAt = existingPlayer.joinedAt || new Date().toISOString();
    syncedRoom.updatedAt = new Date().toISOString();

    await Promise.all([
      persistRoom(syncedRoom),
      putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(syncedRoom, session)),
    ]);

    return syncedRoom;
  }

  if (syncedRoom.players.length >= syncedRoom.maxPlayers) {
    throw new HttpError(409, "That public room is already full.");
  }

  syncedRoom.players.push({
    id: session.playerId,
    token: session.token,
    name: session.name,
    avatar: normalizeAvatarSelection(session.avatar),
    joinedAt: new Date().toISOString(),
  });
  syncedRoom.scores = {
    ...syncedRoom.scores,
    [session.playerId]: 0,
  };

  if (syncedRoom.players.length >= PUBLIC_ROOM_MIN_PLAYERS && !syncedRoom.lobbyStartsAt) {
    syncedRoom.lobbyStartsAt = new Date(Date.now() + PUBLIC_LOBBY_COUNTDOWN_MS).toISOString();
  }

  syncedRoom.updatedAt = new Date().toISOString();

  await Promise.all([
    persistRoom(syncedRoom),
    putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(syncedRoom, session)),
  ]);

  return syncedRoom;
}

function buildPlayerAssignment(room, session) {
  return {
    playerId: session.playerId,
    token: session.token,
    roomId: room.id,
    name: session.name,
    avatar: session.avatar,
    assignedAt: new Date().toISOString(),
  };
}

async function createRoom(origin, players, options = {}) {
  const playableImages = shuffleArray(await listPlayableCatalogImages(origin));

  if (!playableImages.length) {
    throw new HttpError(503, "No approved images are available for online play yet.");
  }

  const rounds = playableImages.slice(0, Math.min(ROUND_COUNT, playableImages.length)).map((image) => ({
    id: image.id,
    imageUrl: image.imageUrl,
    answer: image.answer,
    acceptedAnswers: image.acceptedAnswers || [],
    focusX: image.focusX || 50,
    focusY: image.focusY || 50,
  }));

  const now = Date.now();
  const roomId = randomUUID();
  const status = options.status === ROOM_STATUS_WAITING ? ROOM_STATUS_WAITING : ROOM_STATUS_LIVE;

  return {
    id: roomId,
    type: options.type === ROOM_TYPE_PRIVATE ? ROOM_TYPE_PRIVATE : ROOM_TYPE_PUBLIC,
    status,
    hostId: normalizeId(options.hostId) || players[0]?.playerId || "",
    maxPlayers: clampRoomSize(options.maxPlayers),
    lobbyStartsAt: status === ROOM_STATUS_WAITING ? String(options.lobbyStartsAt || "") : "",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    players: players.map((player) => ({
      id: player.playerId,
      token: player.token,
      name: player.name,
      avatar: normalizeAvatarSelection(player.avatar),
      joinedAt: new Date(now).toISOString(),
    })),
    rounds,
    currentRoundIndex: 0,
    currentRoundStartedAt: status === ROOM_STATUS_LIVE ? new Date(now + ROUND_COUNTDOWN_MS).toISOString() : "",
    currentRoundResolvedAt: "",
    currentRoundWinnerId: "",
    currentRoundWinningGuess: "",
    currentRoundGuesses: {},
    completedRounds: [],
    scores: Object.fromEntries(players.map((player) => [player.playerId, 0])),
    winnerId: "",
    finishedAt: "",
    endedReason: "",
    winsRecordedAt: "",
  };
}

async function syncRoom(room) {
  const now = Date.now();
  const nextRoom = normalizeRoom(room);
  let changed = false;

  while (true) {
    if (nextRoom.status === ROOM_STATUS_WAITING) {
      if (nextRoom.type === ROOM_TYPE_PUBLIC) {
        if (nextRoom.players.length < PUBLIC_ROOM_MIN_PLAYERS) {
          if (nextRoom.lobbyStartsAt) {
            nextRoom.lobbyStartsAt = "";
            nextRoom.updatedAt = new Date(now).toISOString();
            changed = true;
          }
          break;
        }

        const lobbyStartsAtMs = Date.parse(nextRoom.lobbyStartsAt || "");

        if (!Number.isFinite(lobbyStartsAtMs)) {
          nextRoom.lobbyStartsAt = new Date(now + PUBLIC_LOBBY_COUNTDOWN_MS).toISOString();
          nextRoom.updatedAt = new Date(now).toISOString();
          changed = true;
          break;
        }

        if (now < lobbyStartsAtMs) {
          break;
        }

        nextRoom.status = ROOM_STATUS_LIVE;
        nextRoom.currentRoundIndex = 0;
        nextRoom.currentRoundStartedAt = toIso(lobbyStartsAtMs);
        nextRoom.currentRoundResolvedAt = "";
        nextRoom.currentRoundWinnerId = "";
        nextRoom.currentRoundWinningGuess = "";
        nextRoom.currentRoundGuesses = {};
        nextRoom.lobbyStartsAt = "";
        nextRoom.updatedAt = new Date(now).toISOString();
        changed = true;
        continue;
      }

      break;
    }

    if (nextRoom.status === ROOM_STATUS_FINISHED) {
      if (!nextRoom.winsRecordedAt && nextRoom.winnerId) {
        await recordMatchWin(nextRoom, nextRoom.winnerId);
        nextRoom.winsRecordedAt = new Date().toISOString();
        nextRoom.updatedAt = nextRoom.winsRecordedAt;
        changed = true;
      }
      break;
    }

    if (nextRoom.players.length <= 1) {
      nextRoom.status = ROOM_STATUS_FINISHED;
      nextRoom.finishedAt = new Date(now).toISOString();
      nextRoom.winnerId = nextRoom.players[0]?.id || "";
      nextRoom.endedReason = nextRoom.endedReason || "last-player-standing";
      nextRoom.updatedAt = nextRoom.finishedAt;
      changed = true;
      continue;
    }

    if (nextRoom.currentRoundIndex >= nextRoom.rounds.length) {
      nextRoom.status = ROOM_STATUS_FINISHED;
      nextRoom.finishedAt = new Date(now).toISOString();
      nextRoom.winnerId = resolveMatchWinnerId(nextRoom);
      nextRoom.endedReason = nextRoom.endedReason || "completed";
      nextRoom.updatedAt = nextRoom.finishedAt;
      changed = true;
      continue;
    }

    const roundStartedAtMs = Date.parse(nextRoom.currentRoundStartedAt || "");
    const roundResolvedAtMs = Date.parse(nextRoom.currentRoundResolvedAt || "");

    if (Number.isFinite(roundResolvedAtMs)) {
      if (now < roundResolvedAtMs + ROUND_INTERMISSION_MS) {
        break;
      }

      if (shouldFinishMatch(nextRoom)) {
        nextRoom.status = ROOM_STATUS_FINISHED;
        nextRoom.finishedAt = new Date(now).toISOString();
        nextRoom.winnerId = resolveMatchWinnerId(nextRoom);
        nextRoom.endedReason = nextRoom.endedReason || "completed";
        nextRoom.updatedAt = nextRoom.finishedAt;
        changed = true;
        continue;
      }

      nextRoom.currentRoundIndex += 1;
      nextRoom.currentRoundStartedAt = new Date(now + ROUND_COUNTDOWN_MS).toISOString();
      nextRoom.currentRoundResolvedAt = "";
      nextRoom.currentRoundWinnerId = "";
      nextRoom.currentRoundWinningGuess = "";
      nextRoom.currentRoundGuesses = {};
      nextRoom.updatedAt = new Date(now).toISOString();
      changed = true;
      continue;
    }

    if (Number.isFinite(roundStartedAtMs) && now < roundStartedAtMs) {
      break;
    }

    if (Number.isFinite(roundStartedAtMs) && now >= roundStartedAtMs + ROUND_DURATION_MS) {
      resolveCurrentRound(nextRoom, {
        winnerId: "",
        winningGuess: "",
        resolvedAt: roundStartedAtMs + ROUND_DURATION_MS,
        reason: "timeout",
      });
      changed = true;
      continue;
    }

    break;
  }

  return nextRoom;
}

function shouldFinishMatch(room) {
  if (room.currentRoundIndex >= room.rounds.length - 1) {
    return true;
  }

  const targetWins = Math.floor(room.rounds.length / 2) + 1;
  return room.players.some((player) => normalizeScore(room.scores[player.id]) >= targetWins);
}

async function finalizeRoom(room) {
  const syncedRoom = await syncRoom(room);

  if (syncedRoom.status !== ROOM_STATUS_FINISHED) {
    syncedRoom.status = ROOM_STATUS_FINISHED;
    syncedRoom.finishedAt = new Date().toISOString();
    syncedRoom.winnerId = resolveMatchWinnerId(syncedRoom);
    syncedRoom.endedReason = syncedRoom.endedReason || "completed";
  }

  if (!syncedRoom.winsRecordedAt && syncedRoom.winnerId) {
    await recordMatchWin(syncedRoom, syncedRoom.winnerId);
    syncedRoom.winsRecordedAt = new Date().toISOString();
  }

  syncedRoom.updatedAt = new Date().toISOString();

  Object.assign(room, syncedRoom);
  return room;
}

async function persistRoom(room) {
  await putJson(roomKey(room.id), room);
}

function resolveCurrentRound(room, payload) {
  if (room.currentRoundResolvedAt) {
    return;
  }

  const currentRound = room.rounds[room.currentRoundIndex];
  const resolvedAt = toIso(payload.resolvedAt);
  const winnerId = String(payload.winnerId || "");
  const winningGuess = String(payload.winningGuess || "").trim();

  room.currentRoundResolvedAt = resolvedAt;
  room.currentRoundWinnerId = winnerId;
  room.currentRoundWinningGuess = winningGuess;
  room.updatedAt = resolvedAt;

  if (winnerId) {
    room.scores = {
      ...room.scores,
      [winnerId]: normalizeScore(room.scores[winnerId]) + 1,
    };
  }

  room.completedRounds.push({
    roundNumber: room.currentRoundIndex + 1,
    winnerId,
    winningGuess,
    answer: currentRound.answer,
    reason: payload.reason || (winnerId ? "guess" : "timeout"),
    resolvedAt,
  });
}

function resolveMatchWinnerId(room) {
  const sorted = room.players
    .map((player) => ({
      id: player.id,
      score: normalizeScore(room.scores[player.id]),
    }))
    .sort((left, right) => right.score - left.score);

  if (!sorted.length || sorted[0].score === sorted[1]?.score) {
    return "";
  }

  return sorted[0].id;
}

async function recordMatchWin(room, winnerId) {
  const winner = room.players.find((player) => player.id === winnerId);

  if (!winner?.name) {
    return;
  }

  const payload = await getJson(ONLINE_WINS_KEY);
  const leaders = Array.isArray(payload?.leaders) ? payload.leaders : [];
  const key = normalizeName(winner.name).toLocaleLowerCase("en-CA");
  const nextLeaders = [];
  let matched = false;

  for (const entry of leaders) {
    const normalizedName = normalizeName(entry?.name);

    if (!normalizedName) {
      continue;
    }

    if (normalizedName.toLocaleLowerCase("en-CA") === key) {
      nextLeaders.push({
        name: normalizedName,
        avatar: normalizeAvatarSelection(winner.avatar || entry?.avatar),
        wins: normalizeScore(entry?.wins) + 1,
      });
      matched = true;
      continue;
    }

    nextLeaders.push({
      name: normalizedName,
      avatar: normalizeAvatarSelection(entry?.avatar),
      wins: normalizeScore(entry?.wins),
    });
  }

  if (!matched) {
    nextLeaders.push({
      name: normalizeName(winner.name),
      avatar: normalizeAvatarSelection(winner.avatar),
      wins: 1,
    });
  }

  nextLeaders.sort((left, right) => right.wins - left.wins || left.name.localeCompare(right.name));

  await putJson(ONLINE_WINS_KEY, {
    updatedAt: new Date().toISOString(),
    leaders: nextLeaders,
  });
}

function buildPublicRoomState(room, playerId, origin) {
  validatePlayerToken(room, playerId);

  const now = Date.now();
  const you = room.players.find((player) => player.id === playerId) || null;
  const primaryOpponent = room.players.find((player) => player.id !== playerId) || null;
  const currentRound =
    room.status === ROOM_STATUS_WAITING
      ? null
      : room.rounds[room.currentRoundIndex] || room.rounds.at(-1) || null;
  const currentRoundStartedAtMs = Date.parse(room.currentRoundStartedAt || "");
  const currentRoundResolvedAtMs = Date.parse(room.currentRoundResolvedAt || "");
  const countdownMs =
    Number.isFinite(currentRoundStartedAtMs) && now < currentRoundStartedAtMs
      ? currentRoundStartedAtMs - now
      : 0;
  const elapsedMs =
    Number.isFinite(currentRoundStartedAtMs) && now > currentRoundStartedAtMs
      ? now - currentRoundStartedAtMs
      : 0;
  const zoomStepIndex = room.currentRoundResolvedAt
    ? ZOOM_LEVELS.length - 1
    : Math.min(Math.floor(elapsedMs / ROUND_STEP_MS), ZOOM_LEVELS.length - 1);
  const nextZoomInMs =
    room.currentRoundResolvedAt || countdownMs
      ? 0
      : zoomStepIndex < ZOOM_LEVELS.length - 1
        ? Math.max(0, ROUND_STEP_MS - (elapsedMs % ROUND_STEP_MS))
        : 0;
  const endsInMs = room.currentRoundResolvedAt
    ? 0
    : Math.max(0, ROUND_DURATION_MS - elapsedMs) + countdownMs;
  const players = buildPublicPlayers(room, playerId);
  const lobbyStartsAtMs = Date.parse(room.lobbyStartsAt || "");
  const startsInMs =
    room.status === ROOM_STATUS_WAITING &&
    room.type === ROOM_TYPE_PUBLIC &&
    Number.isFinite(lobbyStartsAtMs)
      ? Math.max(0, lobbyStartsAtMs - now)
      : 0;

  return {
    id: room.id,
    type: room.type,
    status: room.status,
    isHost: room.hostId === playerId,
    hostId: room.hostId,
    hostName: resolvePlayerName(room, room.hostId),
    maxPlayers: room.maxPlayers,
    playerCount: room.players.length,
    lobbyStartsAt: room.lobbyStartsAt || "",
    startsInMs,
    canStart:
      room.type === ROOM_TYPE_PRIVATE &&
      room.status === ROOM_STATUS_WAITING &&
      room.hostId === playerId &&
      room.players.length >= 2,
    shareUrl: room.type === ROOM_TYPE_PRIVATE ? buildPrivateRoomShareUrl(origin, room.id) : "",
    roundIndex: room.rounds.length ? Math.min(room.currentRoundIndex + 1, room.rounds.length) : 0,
    roundCount: room.rounds.length,
    you: buildPublicPlayer(you, room.scores, playerId),
    opponent: buildPublicPlayer(primaryOpponent, room.scores, playerId),
    players,
    currentRound: currentRound
      ? {
          imageUrl: currentRound.imageUrl,
          focusX: currentRound.focusX || 50,
          focusY: currentRound.focusY || 50,
          startedAt: room.currentRoundStartedAt,
          zoomScale: room.currentRoundResolvedAt ? 1 : ZOOM_LEVELS[zoomStepIndex],
          zoomLevels: ZOOM_LEVELS,
          zoomStepMs: ROUND_STEP_MS,
          roundDurationMs: ROUND_DURATION_MS,
          intermissionMs: ROUND_INTERMISSION_MS,
          countdownMs,
          nextZoomInMs,
          endsInMs,
          resolvedAt: room.currentRoundResolvedAt,
          winnerId: room.currentRoundWinnerId,
          winnerName: resolvePlayerName(room, room.currentRoundWinnerId),
          winningGuess: room.currentRoundWinningGuess,
          answer: room.currentRoundResolvedAt ? currentRound.answer : "",
          youGuesses: getPublicGuesses(room.currentRoundGuesses?.[playerId]),
          opponentGuesses: getPublicGuesses(room.currentRoundGuesses?.[primaryOpponent?.id]),
          roomGuesses: getPublicRoomGuesses(room.currentRoundGuesses, room.players, playerId),
        }
      : null,
    completedRounds: room.completedRounds.map((round) => ({
      roundNumber: round.roundNumber,
      winnerId: round.winnerId,
      winnerName: resolvePlayerName(room, round.winnerId),
      answer: round.answer,
      reason: round.reason,
    })),
    winnerId: room.winnerId,
    winnerName: resolvePlayerName(room, room.winnerId),
    endedReason: room.endedReason || "",
  };
}

function buildPublicPlayers(room, currentPlayerId) {
  const players = room.players.map((player) => buildPublicPlayer(player, room.scores, currentPlayerId));

  players.sort((left, right) => {
    if (room.status === ROOM_STATUS_WAITING) {
      return Date.parse(left.joinedAt || 0) - Date.parse(right.joinedAt || 0);
    }

    return (
      normalizeScore(right.score) - normalizeScore(left.score) ||
      Date.parse(left.joinedAt || 0) - Date.parse(right.joinedAt || 0)
    );
  });

  return players;
}

function buildPublicPlayer(player, scores, currentPlayerId = "") {
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    name: player.name,
    avatar: normalizeAvatarSelection(player.avatar),
    score: normalizeScore(scores[player.id]),
    joinedAt: player.joinedAt || "",
    isYou: currentPlayerId ? player.id === currentPlayerId : false,
  };
}

function getPublicGuesses(guesses) {
  return Array.isArray(guesses)
    ? guesses.map((entry) => ({
        guess: entry.guess,
        correct: Boolean(entry.correct),
      }))
    : [];
}

function getPublicRoomGuesses(guessesByPlayer, players, currentPlayerId) {
  if (!guessesByPlayer || typeof guessesByPlayer !== "object") {
    return [];
  }

  const playerLookup = new Map(players.map((player) => [player.id, player.name]));
  const guesses = [];

  for (const [playerId, entries] of Object.entries(guessesByPlayer)) {
    if (playerId === currentPlayerId || !Array.isArray(entries)) {
      continue;
    }

    const playerName = playerLookup.get(playerId) || "Player";

    for (const entry of entries) {
      guesses.push({
        playerId,
        playerName,
        guess: entry.guess,
        correct: Boolean(entry.correct),
        at: entry.at || "",
      });
    }
  }

  guesses.sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0));
  return guesses.slice(-ROOM_GUESS_FEED_LIMIT);
}

async function loadActiveQueueEntries() {
  const entries = (await listJson(`${ONLINE_QUEUE_PREFIX}/`)).filter((entry) => {
    return entry?.playerId && entry?.token && entry?.name;
  });
  const activeEntries = [];

  await Promise.all(
    entries.map(async (entry) => {
      if (isTimestampFresh(entry.updatedAt || entry.joinedAt, QUEUE_STALE_MS)) {
        activeEntries.push({
          playerId: entry.playerId,
          token: entry.token,
          name: normalizeName(entry.name),
          avatar: normalizeAvatarSelection(entry.avatar),
          joinedAt: entry.joinedAt,
        });
        return;
      }

      await deleteObject(queueEntryKey(entry.playerId)).catch(() => {});
    }),
  );

  activeEntries.sort((left, right) => Date.parse(left.joinedAt || 0) - Date.parse(right.joinedAt || 0));
  return activeEntries;
}

async function refreshQueueHeartbeat(queueEntry, session) {
  const updatedAtMs = Date.parse(String(queueEntry.updatedAt || queueEntry.joinedAt || ""));

  if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < QUEUE_HEARTBEAT_MS) {
    return;
  }

  await putJson(queueEntryKey(session.playerId), {
    ...queueEntry,
    name: normalizeName(queueEntry.name || session.name),
    avatar: normalizeAvatarSelection(queueEntry.avatar || session.avatar),
    updatedAt: new Date().toISOString(),
  });
}

async function removePlayerFromPrivateRoom(room, playerId) {
  room.players = room.players.filter((player) => player.id !== playerId);
  delete room.scores[playerId];
  delete room.currentRoundGuesses[playerId];

  if (!room.players.length) {
    return null;
  }

  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id || "";
  }

  if (room.status === ROOM_STATUS_WAITING) {
    room.updatedAt = new Date().toISOString();
    return room;
  }

  if (room.status === ROOM_STATUS_LIVE && room.players.length <= 1) {
    room.status = ROOM_STATUS_FINISHED;
    room.finishedAt = new Date().toISOString();
    room.winnerId = room.players[0]?.id || "";
    room.endedReason = "last-player-standing";
    room.updatedAt = room.finishedAt;
    await finalizeRoom(room);
    return room;
  }

  room.updatedAt = new Date().toISOString();
  return room;
}

async function removePlayerFromPublicWaitingRoom(room, playerId) {
  room.players = room.players.filter((player) => player.id !== playerId);
  delete room.scores[playerId];
  delete room.currentRoundGuesses[playerId];

  if (!room.players.length) {
    return null;
  }

  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id || "";
  }

  if (room.players.length < PUBLIC_ROOM_MIN_PLAYERS) {
    room.lobbyStartsAt = "";
  }

  room.updatedAt = new Date().toISOString();
  return room;
}

async function findJoinablePublicRoom(origin, currentPlayerId) {
  const rooms = await listJson(`${ONLINE_ROOM_PREFIX}/`);
  const candidates = [];

  for (const entry of rooms) {
    const room = normalizeRoom(entry);

    if (!room?.id || room.type !== ROOM_TYPE_PUBLIC) {
      continue;
    }

    const syncedRoom = await syncRoom(room);

    if (didRoomChange(room, syncedRoom)) {
      await persistRoom(syncedRoom);
    }

    if (
      syncedRoom.status === ROOM_STATUS_WAITING &&
      syncedRoom.players.length < syncedRoom.maxPlayers &&
      !syncedRoom.players.some((player) => player.id === currentPlayerId)
    ) {
      candidates.push(syncedRoom);
    }
  }

  candidates.sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));
  return candidates[0] || null;
}

function buildPrivateRoomShareUrl(origin, roomId) {
  return `${origin}/play-online/?room=${encodeURIComponent(roomId)}&autoplay=1`;
}

function queueEntryKey(playerId) {
  return `${ONLINE_QUEUE_PREFIX}/${playerId}.json`;
}

function playerAssignmentKey(playerId) {
  return `${ONLINE_PLAYER_PREFIX}/${playerId}.json`;
}

function roomKey(roomId) {
  return `${ONLINE_ROOM_PREFIX}/${roomId}.json`;
}

function normalizeSession({ name, playerId = "", token = "", avatar }, options = {}) {
  const { requireName = true } = options;
  const normalizedPlayerId = normalizeId(playerId) || randomUUID();
  const normalizedToken = normalizeId(token) || randomUUID();
  const normalizedAvatar = normalizeAvatarSelection(avatar);

  if (requireName) {
    const normalizedName = normalizeName(name);

    if (!normalizedName) {
      throw new HttpError(400, "Type your name before joining online mode.");
    }

    return {
      playerId: normalizedPlayerId,
      token: normalizedToken,
      name: normalizedName,
      avatar: normalizedAvatar,
    };
  }

  if (!normalizeId(playerId) || !normalizeId(token)) {
    throw new HttpError(400, "That online session link is incomplete.");
  }

  return {
    playerId: normalizedPlayerId,
    token: normalizedToken,
    name: "",
    avatar: normalizedAvatar,
  };
}

function validatePlayerToken(room, playerId, token = "") {
  const player = room.players.find((entry) => entry.id === playerId);

  if (!player) {
    throw new HttpError(404, "That player is not part of this room.");
  }

  if (token && player.token !== token) {
    throw new HttpError(401, "That online session is not valid anymore.");
  }
}

function normalizeRoom(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    ...value,
    id: normalizeId(value?.id) || "",
    type: value?.type === ROOM_TYPE_PRIVATE ? ROOM_TYPE_PRIVATE : ROOM_TYPE_PUBLIC,
    status: normalizeRoomStatus(value?.status),
    hostId: normalizeId(value?.hostId) || "",
    maxPlayers: clampRoomSize(value?.maxPlayers),
    lobbyStartsAt: String(value?.lobbyStartsAt || ""),
    players: Array.isArray(value?.players)
      ? value.players
          .filter((player) => normalizeId(player?.id) && normalizeId(player?.token))
          .map((player) => ({
            ...player,
            id: normalizeId(player.id),
            token: normalizeId(player.token),
            name: normalizeName(player?.name),
            avatar: normalizeAvatarSelection(player?.avatar),
            joinedAt: player?.joinedAt || new Date().toISOString(),
          }))
      : [],
    rounds: Array.isArray(value?.rounds) ? value.rounds : [],
    currentRoundIndex: normalizeRoundIndex(value?.currentRoundIndex),
    currentRoundStartedAt: value?.currentRoundStartedAt || "",
    currentRoundResolvedAt: value?.currentRoundResolvedAt || "",
    currentRoundWinnerId: normalizeId(value?.currentRoundWinnerId) || "",
    currentRoundWinningGuess: String(value?.currentRoundWinningGuess || ""),
    currentRoundGuesses:
      value?.currentRoundGuesses && typeof value.currentRoundGuesses === "object"
        ? value.currentRoundGuesses
        : {},
    completedRounds: Array.isArray(value?.completedRounds) ? value.completedRounds : [],
    scores: value?.scores && typeof value.scores === "object" ? value.scores : {},
    winnerId: normalizeId(value?.winnerId) || "",
    finishedAt: String(value?.finishedAt || ""),
    endedReason: String(value?.endedReason || ""),
    winsRecordedAt: String(value?.winsRecordedAt || ""),
    updatedAt: value?.updatedAt || new Date().toISOString(),
    createdAt: value?.createdAt || new Date().toISOString(),
  };
}

function normalizeRoomStatus(value) {
  if (value === ROOM_STATUS_WAITING) {
    return ROOM_STATUS_WAITING;
  }

  if (value === ROOM_STATUS_FINISHED) {
    return ROOM_STATUS_FINISHED;
  }

  return ROOM_STATUS_LIVE;
}

function normalizeRoundIndex(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function clampRoomSize(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 2) {
    return PUBLIC_ROOM_MIN_PLAYERS;
  }

  return Math.min(Math.floor(parsed), PRIVATE_ROOM_MAX_PLAYERS);
}

function normalizeId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(normalized) ? normalized : "";
}

function normalizeName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function normalizeGuess(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGuessDisplay(value) {
  return censorProfanity(value, { maxLength: 80 });
}

function isCorrectGuess(guess, round) {
  const answers = [round.answer, ...(round.acceptedAnswers || [])].map(normalizeGuess).filter(Boolean);

  return answers.some((answer) => {
    const shortestLength = Math.min(answer.length, guess.length);
    return answer === guess || (shortestLength >= 4 && (answer.includes(guess) || guess.includes(answer)));
  });
}

function trimGuessHistory(values) {
  return values.slice(-RECENT_GUESSES_LIMIT);
}

function resolvePlayerName(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.name || "";
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isTimestampFresh(value, maxAgeMs) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && Date.now() - parsed <= maxAgeMs;
}

function toIso(value) {
  const parsed = typeof value === "number" ? value : Date.parse(String(value || ""));
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

function shuffleArray(values) {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}

function didRoomChange(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}
