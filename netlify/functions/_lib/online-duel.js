import { randomUUID } from "node:crypto";
import { normalizeAvatarSelection } from "./avatar-selection.js";
import { generateBotChat, generateBotReaction, generateBotWrongGuess } from "./bot-ai.js";
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
const PUBLIC_LOBBY_COUNTDOWN_MS = 0;
const QUEUE_STALE_MS = 2 * 60 * 1000;
const QUEUE_HEARTBEAT_MS = 30 * 1000;
const ROOM_PLAYER_HEARTBEAT_MS = 10 * 1000;
const WAITING_ROOM_PLAYER_STALE_MS = 20 * 1000;
const LIVE_ROOM_PLAYER_STALE_MS = 30 * 1000;
const ROUND_COUNT = 3;
const ROUND_COUNTDOWN_MS = 0;
const ROUND_INTERMISSION_MS = 3500;
// Each zoom level lasts a different amount of time (most → least zoomed in)
const ZOOM_STEP_DURATIONS_MS = [20000, 15000, 10000, 5000];
const ZOOM_LEVELS = [4.6, 3.2, 2.2, 1.0];
const ROUND_STEP_MS = ZOOM_STEP_DURATIONS_MS[0]; // kept for bot zoom-step index calc
const ROUND_DURATION_MS = ZOOM_STEP_DURATIONS_MS.reduce((s, d) => s + d, 0);
const RECENT_GUESSES_LIMIT = 6;
const ROOM_GUESS_FEED_LIMIT = 16;
const MIN_GUESS_GAP_MS = 700;

// Bot constants
const BOT_NAMES = ["Alex", "Jamie", "Jordan", "Sam", "Riley", "Taylor", "Morgan", "Casey", "Drew", "Quinn", "Avery", "Blake"];
// Bot guess timing — uses a bimodal distribution: sometimes very fast, sometimes slow
const BOT_GUESS_FAST_MIN_MS = 10 * 1000;
const BOT_GUESS_FAST_MAX_MS = 18 * 1000;
const BOT_GUESS_SLOW_MIN_MS = 28 * 1000;
const BOT_GUESS_SLOW_MAX_MS = 45 * 1000;
// After the bot reacts to a human message, it waits longer before its next guess
const BOT_POST_INSULT_COOLDOWN_MS = 15 * 1000;
const BOT_CORRECT_GUESS_MIN_STEP = 3; // bot guesses correctly starting at zoom step 3 (4th level)
// Wrong guesses that look plausible for zoomed-in UW campus photos
const BOT_WRONG_GUESSES = [
  "Dana Porter", "Davis Centre", "SLC", "PAC", "CIF", "RCH", "E7", "E5", "QNC",
  "Needles Hall", "Fed Hall", "BMH", "MC building", "Ring Road", "Village",
  "REV", "Ron Eydt Village", "Earth Sciences", "Science Teaching Complex",
  "Columbia Lake", "Waterloo Park", "WatCard", "Commissary", "goose fountain",
  "Physics building", "Chemistry building", "Engineering building", "Math faculty",
  "Student Life Centre", "Modern Languages", "Anthropology building", "Conrad Grebel",
  "Renison", "St. Paul's", "Engineering 3", "Engineering 6",
  "Laurel Creek", "DC library", "Optometry building", "Environment building",
];

/**
 * Returns true if the guess looks like trash talk / chat rather than a genuine
 * campus location guess. Used to decide whether the bot should react.
 * A "real" guess typically references a known building, acronym, or place name.
 * Chat messages tend to be greetings, taunts, filler words, or random phrases.
 */
/**
 * Build a hangman-style letter hint for the answer.
 * Returns a string like "_ _ _ _  _ _ _ _ _ _" with some letters progressively revealed.
 * Words are separated by "  " (two spaces); letters within a word by " ".
 */
function buildLetterHint(answer, zoomStepIndex) {
  if (!answer) return "";

  const words = answer.split(" ");

  // Collect all letter positions across all words as {wordIdx, charIdx}
  const positions = [];
  for (let w = 0; w < words.length; w++) {
    for (let c = 0; c < words[w].length; c++) {
      if (/[a-zA-Z0-9]/.test(words[w][c])) {
        positions.push({ w, c });
      }
    }
  }

  // Deterministic shuffle using answer as seed (LCG)
  let seed = 0;
  for (let i = 0; i < answer.length; i++) {
    seed = (Math.imul(31, seed) + answer.charCodeAt(i)) | 0;
  }
  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    const j = Math.abs(seed) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Reveal progressively more letters per zoom step (0%, 25%, 50%, 75%)
  const total = shuffled.length;
  const revealFractions = [0, 0.25, 0.5, 0.75];
  const fraction = revealFractions[Math.min(zoomStepIndex, revealFractions.length - 1)];
  const revealCount = Math.floor(total * fraction);
  const revealed = new Set(shuffled.slice(0, revealCount).map(({ w, c }) => `${w},${c}`));

  // Build per-word hint strings
  return words
    .map((word, w) =>
      Array.from(word)
        .map((ch, c) => {
          if (!/[a-zA-Z0-9]/.test(ch)) return ch; // keep hyphens, apostrophes etc.
          return revealed.has(`${w},${c}`) ? ch.toLowerCase() : "_";
        })
        .join(" "),
    )
    .join("  ");
}

function looksLikeChatNotGuess(guess) {
  if (!guess) return false;
  const g = guess.trim().toLowerCase();

  // Very short single-word fillers / reactions
  const chatWords = new Set([
    "lol", "lmao", "lmfao", "haha", "hahaha", "lololol", "gg", "ggs", "ez", "rip",
    "hi", "hello", "hey", "yo", "sup", "wsg", "wsp", "wassup", "howdy",
    "idk", "idc", "idek", "wtf", "omg", "bruh", "bro", "sis", "bestie",
    "no", "nah", "nope", "yes", "yep", "yeah", "yup", "ok", "okay", "k",
    "gg", "wp", "nice", "poggers", "pog", "based", "cringe", "mid",
    "help", "what", "huh", "wait", "hmm", "ugh", "meh", "damn", "dang",
    "stop", "quit", "leave", "go", "run", "skip", "pass",
    "you", "me", "us", "them", "we",
    "bot", "ai", "cheat", "cheater", "hacker",
    "fr", "frfr", "ngl", "tbh", "imo", "smh", "ffs",
    "good", "bad", "easy", "hard", "impossible",
  ]);

  // Single word — only chat if it's in the known chat set, otherwise might be a building acronym
  const words = g.split(/\s+/);
  if (words.length === 1) {
    return chatWords.has(g);
  }

  // Multi-word: chat if it starts with a greeting/reaction pattern or contains no location-like nouns
  const chatPrefixes = ["i think", "i dont", "i don't", "i give", "i quit", "i have", "i want",
    "you are", "you're", "ur so", "this is", "that is", "what is", "where is",
    "no way", "oh my", "come on", "let me", "let's go", "lets go",
    "help me", "i have no", "i give up"];
  if (chatPrefixes.some((p) => g.startsWith(p))) return true;

  // If it contains any word from the chat set at the start, lean chat
  if (chatWords.has(words[0])) return true;

  // Otherwise assume it's a genuine location guess
  return false;
}

export async function createPrivateOnlineDuelRoom({ origin, name, playerId, token, avatar }) {
  requireOnlineStorage();

  const session = normalizeSession({ name, playerId, token, avatar }, { requireName: true });
  const existing = await getExistingPlayerState(origin, session);

  if (existing.status === ROOM_STATUS_WAITING || existing.status === ROOM_STATUS_LIVE) {
    if (existing.room?.type === ROOM_TYPE_PRIVATE) {
      return {
        ...existing,
        playerId: session.playerId,
        token: session.token,
      };
    }

    if (existing.status === ROOM_STATUS_LIVE) {
      throw new HttpError(409, "Leave your current live public match before creating a private room.");
    }

    await leaveOnlineDuel({
      origin,
      playerId: session.playerId,
      token: session.token,
    });
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
      status: ROOM_STATUS_LIVE,
      maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
      hostId: opponent.playerId,
    });

    await Promise.all([
      putJson(roomKey(room.id), room),
      putJson(playerAssignmentKey(opponent.playerId), buildPlayerAssignment(room, opponent)),
      putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(room, session)),
      deleteObject(queueEntryKey(opponent.playerId)).catch(() => {}),
      deleteObject(queueEntryKey(session.playerId)).catch(() => {}),
    ]);

    return {
      status: room.status,
      playerId: session.playerId,
      token: session.token,
      room: buildPublicRoomState(room, session.playerId, origin),
    };
  }

  // No human opponents — pair with a bot and start immediately
  const bot = createBotSession();
  const room = await createRoom(origin, [session, bot], {
    type: ROOM_TYPE_PUBLIC,
    status: ROOM_STATUS_LIVE,
    maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
    hostId: session.playerId,
    botPlayerId: bot.playerId,
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

export async function adminEndOnlineDuelRoom({ roomId }) {
  requireOnlineStorage();

  const id = normalizeId(roomId);
  if (!id) throw new HttpError(400, "Room ID is required.");

  const room = normalizeRoom(await getJson(roomKey(id)));
  if (!room?.id) throw new HttpError(404, "Room not found.");

  if (room.status === ROOM_STATUS_FINISHED) {
    throw new HttpError(409, "Room is already finished.");
  }

  room.status = ROOM_STATUS_FINISHED;
  room.finishedAt = new Date().toISOString();
  room.endedReason = "admin";
  room.updatedAt = new Date().toISOString();

  await persistRoom(room);
  return { ok: true };
}

export async function loadOnlineDuelAdminStats() {
  requireOnlineStorage();

  const queueEntries = await loadActiveQueueEntries();
  const roomEntries = await listJson(`${ONLINE_ROOM_PREFIX}/`);
  const activeRooms = [];
  let totalGamesPlayed = 0;

  for (const entry of roomEntries) {
    const room = normalizeRoom(entry);

    if (!room?.id) {
      continue;
    }

    const syncedRoom = await syncRoom(room);

    if (didRoomChange(room, syncedRoom)) {
      if (!syncedRoom.players.length && syncedRoom.status !== ROOM_STATUS_FINISHED) {
        await deleteObject(roomKey(syncedRoom.id)).catch(() => {});
      } else {
        await persistRoom(syncedRoom);
      }
    }

    if (!syncedRoom.players.length && syncedRoom.status !== ROOM_STATUS_FINISHED) {
      continue;
    }

    if (syncedRoom.status === ROOM_STATUS_FINISHED) {
      totalGamesPlayed += 1;
      continue;
    }

    activeRooms.push(buildAdminRoomState(syncedRoom));
  }

  activeRooms.sort((left, right) => {
    const waitingOrder = left.status === right.status ? 0 : left.status === ROOM_STATUS_WAITING ? -1 : 1;
    if (waitingOrder !== 0) {
      return waitingOrder;
    }

    return Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0);
  });

  const waitingRooms = activeRooms.filter((room) => room.status === ROOM_STATUS_WAITING);
  const liveRooms = activeRooms.filter((room) => room.status === ROOM_STATUS_LIVE);
  const publicWaiting = waitingRooms.filter((room) => room.type === ROOM_TYPE_PUBLIC);
  const privateWaiting = waitingRooms.filter((room) => room.type === ROOM_TYPE_PRIVATE);
  const publicLive = liveRooms.filter((room) => room.type === ROOM_TYPE_PUBLIC);
  const privateLive = liveRooms.filter((room) => room.type === ROOM_TYPE_PRIVATE);

  return {
    updatedAt: new Date().toISOString(),
    totals: {
      totalGamesPlayed,
      activeGames: activeRooms.length,
      waitingRooms: waitingRooms.length,
      liveGames: liveRooms.length,
      publicWaitingLobbies: publicWaiting.length,
      privateWaitingLobbies: privateWaiting.length,
      publicLiveGames: publicLive.length,
      privateLiveGames: privateLive.length,
      queuedPlayers: queueEntries.length,
      waitingLobbyPlayers: waitingRooms.reduce((sum, room) => sum + room.playerCount, 0),
      playersInActiveGames: activeRooms.reduce((sum, room) => sum + room.playerCount, 0),
    },
    queue: queueEntries.map((entry) => ({
      playerId: entry.playerId,
      name: entry.name,
      joinedAt: entry.joinedAt,
      avatar: normalizeAvatarSelection(entry.avatar),
    })),
    rooms: activeRooms,
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

  if (room.status === ROOM_STATUS_LIVE) {
    const nextRoom = await removePlayerFromPublicLiveRoom(room, session.playerId);

    if (!nextRoom) {
      await deleteObject(roomKey(room.id)).catch(() => {});
      return {
        success: true,
        status: "idle",
      };
    }

    await persistRoom(nextRoom);
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
  const playerStillInRoom = syncedRoom.players.some((player) => player.id === session.playerId);

  if (!playerStillInRoom) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
    return null;
  }

  const touchedHeartbeat = touchRoomPlayerHeartbeat(syncedRoom, session.playerId);

  if (didRoomChange(room, syncedRoom) || touchedHeartbeat) {
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
  const playerStillInRoom = syncedRoom.players.some((player) => player.id === session.playerId);

  if (!playerStillInRoom) {
    await deleteObject(playerAssignmentKey(session.playerId)).catch(() => {});
    throw new HttpError(404, "That online match could not be found.");
  }

  const touchedHeartbeat = touchRoomPlayerHeartbeat(syncedRoom, session.playerId);

  if (didRoomChange(room, syncedRoom) || touchedHeartbeat) {
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

  const syncedRoom = await syncRoom(room);

  if (didRoomChange(room, syncedRoom)) {
    await persistRoom(syncedRoom);
  }

  if (!syncedRoom.players.length) {
    throw new HttpError(404, "That private room could not be found.");
  }

  if (syncedRoom.status === ROOM_STATUS_FINISHED) {
    throw new HttpError(409, "That private room has already finished.");
  }

  if (syncedRoom.status === ROOM_STATUS_LIVE) {
    throw new HttpError(409, "That private room has already started.");
  }

  const existingPlayer = syncedRoom.players.find((player) => player.id === session.playerId);

  if (existingPlayer) {
    existingPlayer.token = session.token;
    existingPlayer.name = session.name;
    existingPlayer.avatar = normalizeAvatarSelection(session.avatar);
    existingPlayer.joinedAt = existingPlayer.joinedAt || new Date().toISOString();
    existingPlayer.lastSeenAt = new Date().toISOString();
    syncedRoom.updatedAt = new Date().toISOString();
    await Promise.all([
      persistRoom(syncedRoom),
      putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(syncedRoom, session)),
    ]);
    return syncedRoom;
  }

  if (syncedRoom.players.length >= syncedRoom.maxPlayers) {
    throw new HttpError(409, "That private room is already full.");
  }

  syncedRoom.players.push({
    id: session.playerId,
    token: session.token,
    name: session.name,
    avatar: normalizeAvatarSelection(session.avatar),
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
  syncedRoom.scores = {
    ...syncedRoom.scores,
    [session.playerId]: 0,
  };
  syncedRoom.updatedAt = new Date().toISOString();

  await Promise.all([
    persistRoom(syncedRoom),
    putJson(playerAssignmentKey(session.playerId), buildPlayerAssignment(syncedRoom, session)),
  ]);

  return syncedRoom;
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

  if (syncedRoom.status !== ROOM_STATUS_WAITING && syncedRoom.status !== ROOM_STATUS_LIVE) {
    throw new HttpError(409, "That public room is not joinable anymore.");
  }

  const existingPlayer = syncedRoom.players.find((player) => player.id === session.playerId);

  if (existingPlayer) {
    existingPlayer.token = session.token;
    existingPlayer.name = session.name;
    existingPlayer.avatar = normalizeAvatarSelection(session.avatar);
    existingPlayer.joinedAt = existingPlayer.joinedAt || new Date().toISOString();
    existingPlayer.lastSeenAt = new Date().toISOString();
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
    lastSeenAt: new Date().toISOString(),
  });
  syncedRoom.scores = {
    ...syncedRoom.scores,
    [session.playerId]: 0,
  };

  const now = Date.now();

  if (syncedRoom.status === ROOM_STATUS_WAITING && syncedRoom.players.length >= PUBLIC_ROOM_MIN_PLAYERS) {
    syncedRoom.status = ROOM_STATUS_LIVE;
    syncedRoom.currentRoundIndex = 0;
    syncedRoom.currentRoundStartedAt = new Date(now + ROUND_COUNTDOWN_MS).toISOString();
    syncedRoom.currentRoundResolvedAt = "";
    syncedRoom.currentRoundWinnerId = "";
    syncedRoom.currentRoundWinningGuess = "";
    syncedRoom.currentRoundGuesses = {};
    syncedRoom.lobbyStartsAt = "";
  }

  syncedRoom.updatedAt = new Date(now).toISOString();

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

function createBotSession() {
  const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return {
    playerId: randomUUID(),
    token: randomUUID(),
    name,
    avatar: {
      body: Math.floor(Math.random() * 8),
      eyes: Math.floor(Math.random() * 8),
      mouth: Math.floor(Math.random() * 8),
      extra: Math.floor(Math.random() * 8),
    },
    isBot: true,
  };
}

async function syncBotActions(room, now) {
  if (!room.botPlayerId || room.status !== ROOM_STATUS_LIVE || room.currentRoundResolvedAt) {
    return false;
  }

  const bot = room.players.find((p) => p.id === room.botPlayerId);
  if (!bot) return false;

  // Keep bot heartbeat alive
  bot.lastSeenAt = new Date(now).toISOString();

  const currentRound = room.rounds[room.currentRoundIndex];
  if (!currentRound) return false;

  const roundStartedAtMs = Date.parse(room.currentRoundStartedAt || "");
  if (!Number.isFinite(roundStartedAtMs) || now < roundStartedAtMs) return false;

  const elapsedMs = now - roundStartedAtMs;
  const zoomStepIndex = zoomStepIndexForElapsed(elapsedMs);

  // At step 3+ guess correctly to end the round (always fires regardless of human activity)
  const lastActionAtMs = Date.parse(room.botLastActionAt || "");
  if (zoomStepIndex >= BOT_CORRECT_GUESS_MIN_STEP) {
    const isFast = Math.random() < 0.6;
    const nextActionInterval = isFast
      ? BOT_GUESS_FAST_MIN_MS + Math.floor(Math.random() * (BOT_GUESS_FAST_MAX_MS - BOT_GUESS_FAST_MIN_MS))
      : BOT_GUESS_SLOW_MIN_MS + Math.floor(Math.random() * (BOT_GUESS_SLOW_MAX_MS - BOT_GUESS_SLOW_MIN_MS));
    if (Number.isFinite(lastActionAtMs) && now - lastActionAtMs < nextActionInterval) return false;

    const botGuesses = Array.isArray(room.currentRoundGuesses?.[room.botPlayerId])
      ? room.currentRoundGuesses[room.botPlayerId]
      : [];
    room.currentRoundGuesses = {
      ...room.currentRoundGuesses,
      [room.botPlayerId]: trimGuessHistory([
        ...botGuesses,
        { guess: currentRound.answer, correct: true, at: new Date(now).toISOString() },
      ]),
    };
    resolveCurrentRound(room, {
      winnerId: room.botPlayerId,
      winningGuess: currentRound.answer,
      resolvedAt: now,
      reason: "guess",
    });
    room.botLastActionAt = new Date(now).toISOString();
    return true;
  }

  // All other bot actions only fire if the human has said something since the bot last acted
  const lastHumanActivityMs = Math.max(
    ...Object.entries(room.currentRoundGuesses || {})
      .filter(([pid]) => pid !== room.botPlayerId)
      .flatMap(([, entries]) => (Array.isArray(entries) ? entries : []))
      .map((g) => Date.parse(g.at || "") || 0),
    ...(room.roomChatMessages || [])
      .filter((m) => m.playerId !== room.botPlayerId)
      .map((m) => Date.parse(m.at || "") || 0),
    0,
  );

  // No human activity yet, or bot already responded to the latest human message
  if (lastHumanActivityMs === 0 || (Number.isFinite(lastActionAtMs) && lastActionAtMs > lastHumanActivityMs)) {
    return false;
  }

  // Collect unresponded human messages since last bot action
  const sinceMs = Number.isFinite(lastActionAtMs) ? lastActionAtMs : 0;
  const humanGuesses = Object.entries(room.currentRoundGuesses || {})
    .filter(([pid]) => pid !== room.botPlayerId)
    .flatMap(([, entries]) => (Array.isArray(entries) ? entries : []))
    .filter((g) => Date.parse(g.at || "") > sinceMs);

  // --- React to human chat (fast reply: 2–4s) ---
  const latestHumanChat = humanGuesses
    .filter((g) => !g.correct && looksLikeChatNotGuess(g.guess))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];

  if (latestHumanChat) {
    const chatDelay = 2000 + Math.floor(Math.random() * 2000);
    if (now - Date.parse(latestHumanChat.at) < chatDelay) return false;
    const reaction = await generateBotReaction({ humanMessage: latestHumanChat.guess });
    if (!Array.isArray(room.roomChatMessages)) room.roomChatMessages = [];
    room.roomChatMessages = [
      ...room.roomChatMessages,
      { playerId: room.botPlayerId, name: bot.name, text: reaction, at: new Date(now).toISOString() },
    ].slice(-20);
    room.botLastActionAt = new Date(now).toISOString();
    return true;
  }

  // --- React to human single-word location guess with a bot guess (slower: 6–12s, ~60% chance) ---
  const latestHumanGuess = humanGuesses
    .filter((g) => {
      if (g.correct || looksLikeChatNotGuess(g.guess)) return false;
      return g.guess.trim().split(/\s+/).length === 1;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];

  if (latestHumanGuess && Math.random() < 0.6) {
    const guessDelay = 6000 + Math.floor(Math.random() * 6000);
    if (now - Date.parse(latestHumanGuess.at) < guessDelay) return false;
    const guessText = await generateBotWrongGuess({ zoomStepIndex });
    if (guessText) {
      const botGuesses = Array.isArray(room.currentRoundGuesses?.[room.botPlayerId])
        ? room.currentRoundGuesses[room.botPlayerId]
        : [];
      room.currentRoundGuesses = {
        ...room.currentRoundGuesses,
        [room.botPlayerId]: trimGuessHistory([
          ...botGuesses,
          { guess: guessText, correct: false, at: new Date(now).toISOString() },
        ]),
      };
    }
    room.botLastActionAt = new Date(now).toISOString();
    return true;
  }

  return false;
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
      isBot: Boolean(player.isBot),
      joinedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
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
    botPlayerId: normalizeId(options.botPlayerId) || "",
    botLastActionAt: "",
    botLastInsultAt: "",
    roomChatMessages: [],
  };
}

async function syncRoom(room) {
  const now = Date.now();
  const nextRoom = normalizeRoom(room);
  let changed = false;

  // Refresh bot heartbeat before staleness check so it's never pruned
  if (nextRoom.botPlayerId && nextRoom.status !== ROOM_STATUS_FINISHED) {
    const bot = nextRoom.players.find((p) => p.id === nextRoom.botPlayerId);
    if (bot) {
      bot.lastSeenAt = new Date(now).toISOString();
    }
  }

  if (await pruneStaleRoomPlayers(nextRoom, now)) {
    changed = true;
  }

  // Run bot actions — may submit a guess or resolve the round
  if (await syncBotActions(nextRoom, now)) {
    changed = true;
  }

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
      nextRoom.botLastActionAt = "";
      nextRoom.botLastInsultAt = "";
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

  if (!winner?.name || winner.isBot) {
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
    : zoomStepIndexForElapsed(elapsedMs);
  const nextZoomInMs =
    room.currentRoundResolvedAt || countdownMs ? 0 : nextZoomInMsForElapsed(elapsedMs, zoomStepIndex);
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
          zoomStepMs: ZOOM_STEP_DURATIONS_MS[0],
          zoomStepDurationsMs: ZOOM_STEP_DURATIONS_MS,
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
          letterHint: room.currentRoundResolvedAt ? "" : buildLetterHint(currentRound.answer, zoomStepIndex),
          youGuesses: getPublicGuesses(room.currentRoundGuesses?.[playerId]),
          opponentGuesses: getPublicGuesses(room.currentRoundGuesses?.[primaryOpponent?.id]),
          roomGuesses: getPublicRoomGuesses(room.currentRoundGuesses, room.players, playerId, room.roomChatMessages),
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

function buildAdminRoomState(room) {
  return {
    id: room.id,
    type: room.type,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    hostId: room.hostId,
    hostName: resolvePlayerName(room, room.hostId),
    maxPlayers: room.maxPlayers,
    playerCount: room.players.length,
    lobbyStartsAt: room.lobbyStartsAt || "",
    roundIndex: room.rounds.length ? Math.min(room.currentRoundIndex + 1, room.rounds.length) : 0,
    roundCount: room.rounds.length,
    players: room.players
      .map((player) => ({
        id: player.id,
        name: player.name,
        joinedAt: player.joinedAt || "",
        lastSeenAt: player.lastSeenAt || "",
        score: normalizeScore(room.scores[player.id]),
        isHost: player.id === room.hostId,
      }))
      .sort((left, right) => Date.parse(left.joinedAt || 0) - Date.parse(right.joinedAt || 0)),
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
    // isBot intentionally omitted — keeps the bot indistinguishable client-side
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

function getPublicRoomGuesses(guessesByPlayer, players, currentPlayerId, chatMessages = []) {
  const playerLookup = new Map(players.map((player) => [player.id, player.name]));
  const guesses = [];

  if (guessesByPlayer && typeof guessesByPlayer === "object") {
    for (const [playerId, entries] of Object.entries(guessesByPlayer)) {
      if (!Array.isArray(entries)) continue;
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
  }

  // Merge in bot chat messages
  if (Array.isArray(chatMessages)) {
    for (const msg of chatMessages) {
      guesses.push({
        playerId: msg.playerId,
        playerName: msg.name || playerLookup.get(msg.playerId) || "Player",
        guess: msg.text,
        correct: false,
        isChat: true,
        at: msg.at || "",
      });
    }
  }

  guesses.sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0));
  return guesses.slice(-ROOM_GUESS_FEED_LIMIT);
}

async function pruneStaleRoomPlayers(room, now = Date.now()) {
  if (!room || room.status === ROOM_STATUS_FINISHED || !Array.isArray(room.players) || !room.players.length) {
    return false;
  }

  const stalePlayerIds = room.players
    .filter((player) => !isRoomPlayerFresh(player, room.status, now))
    .map((player) => player.id);

  if (!stalePlayerIds.length) {
    return false;
  }

  room.players = room.players.filter((player) => !stalePlayerIds.includes(player.id));

  for (const playerId of stalePlayerIds) {
    delete room.scores[playerId];
    delete room.currentRoundGuesses[playerId];
  }

  if (stalePlayerIds.includes(room.hostId)) {
    room.hostId = room.players[0]?.id || "";
  }

  if (room.status === ROOM_STATUS_WAITING && room.players.length < PUBLIC_ROOM_MIN_PLAYERS) {
    room.lobbyStartsAt = "";
  }

  room.updatedAt = new Date(now).toISOString();

  await Promise.all(
    stalePlayerIds.map((playerId) => deleteObject(playerAssignmentKey(playerId)).catch(() => {})),
  );

  return true;
}

function touchRoomPlayerHeartbeat(room, playerId, now = Date.now()) {
  const player = room?.players?.find((entry) => entry.id === playerId);

  if (!player) {
    return false;
  }

  const lastSeenAtMs = Date.parse(String(player.lastSeenAt || player.joinedAt || ""));

  if (Number.isFinite(lastSeenAtMs) && now - lastSeenAtMs < ROOM_PLAYER_HEARTBEAT_MS) {
    return false;
  }

  player.lastSeenAt = new Date(now).toISOString();
  room.updatedAt = player.lastSeenAt;
  return true;
}

function isRoomPlayerFresh(player, roomStatus, now = Date.now()) {
  const maxAgeMs =
    roomStatus === ROOM_STATUS_WAITING ? WAITING_ROOM_PLAYER_STALE_MS : LIVE_ROOM_PLAYER_STALE_MS;
  const lastSeenAtMs = Date.parse(String(player?.lastSeenAt || player?.joinedAt || ""));

  return Number.isFinite(lastSeenAtMs) && now - lastSeenAtMs <= maxAgeMs;
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

async function removePlayerFromPublicLiveRoom(room, playerId) {
  room.players = room.players.filter((player) => player.id !== playerId);
  delete room.scores[playerId];
  delete room.currentRoundGuesses[playerId];

  if (!room.players.length) {
    return null;
  }

  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.id || "";
  }

  if (room.players.length <= 1) {
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
      (syncedRoom.status === ROOM_STATUS_WAITING || syncedRoom.status === ROOM_STATUS_LIVE) &&
      syncedRoom.players.length >= 1 &&
      syncedRoom.players.length < syncedRoom.maxPlayers &&
      !syncedRoom.players.some((player) => player.id === currentPlayerId)
    ) {
      candidates.push(syncedRoom);
    }
  }

  candidates.sort((left, right) => {
    const leftPriority = left.status === ROOM_STATUS_LIVE ? 0 : 1;
    const rightPriority = right.status === ROOM_STATUS_LIVE ? 0 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.players.length !== right.players.length) {
      return right.players.length - left.players.length;
    }

    return Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0);
  });
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
            isBot: Boolean(player?.isBot),
            joinedAt: player?.joinedAt || new Date().toISOString(),
            lastSeenAt: player?.lastSeenAt || player?.joinedAt || new Date().toISOString(),
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
    botPlayerId: normalizeId(value?.botPlayerId) || "",
    botLastActionAt: String(value?.botLastActionAt || ""),
    botLastInsultAt: String(value?.botLastInsultAt || ""),
    roomChatMessages: Array.isArray(value?.roomChatMessages) ? value.roomChatMessages : [],
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

function zoomStepIndexForElapsed(elapsedMs) {
  let cumulative = 0;
  for (let i = 0; i < ZOOM_STEP_DURATIONS_MS.length; i++) {
    cumulative += ZOOM_STEP_DURATIONS_MS[i];
    if (elapsedMs < cumulative) return i;
  }
  return ZOOM_STEP_DURATIONS_MS.length - 1;
}

function nextZoomInMsForElapsed(elapsedMs, stepIndex) {
  if (stepIndex >= ZOOM_STEP_DURATIONS_MS.length - 1) return 0;
  const cumulativeEnd = ZOOM_STEP_DURATIONS_MS.slice(0, stepIndex + 1).reduce((s, d) => s + d, 0);
  return Math.max(0, cumulativeEnd - elapsedMs);
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
