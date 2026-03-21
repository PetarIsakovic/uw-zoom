import { ensureAvatarIconAssets, drawAvatarIcon } from "/scripts/avatar-icon.js";
import {
  AVATAR_QUERY_KEYS,
  normalizeAvatarSelection,
  readAvatarSelectionFromSearchParams,
  writeAvatarSelectionToSearchParams,
} from "/shared/avatar-selection.js";
import { censorProfanity, flushPendingOnlineLeave, requestJson } from "/scripts/shared.js";

const leaderboardList = document.querySelector("#landing-leaderboard-list");
const leaderboardEmpty = document.querySelector("#landing-leaderboard-empty");
const onlineWinsList = document.querySelector("#online-wins-list");
const onlineWinsEmpty = document.querySelector("#online-wins-empty");
const topStreaksBoard = document.querySelector("#top-streaks-board");
const onlineWinsBoard = document.querySelector("#online-wins-board");
const landingShell = document.querySelector(".landing-shell");
const landingStartupLoading = document.querySelector("#landing-startup-loading");
const playOnlineLink = document.querySelector("#play-online-link");
const createPrivateRoomLink = document.querySelector("#create-private-room-link");
const startPlayingLink = document.querySelector("#start-playing-link");
const landingPlayerNameInput = document.querySelector("#landing-player-name");
const landingAvatarPreview = document.querySelector("#landing-avatar-preview");
const landingAvatarRandomizeButton = document.querySelector("#landing-avatar-randomize");
const landingAvatarControlButtons = document.querySelectorAll("[data-avatar-control]");
const landingAvatarContext = landingAvatarPreview?.getContext?.("2d");
let playStartWarmupPromise = null;

const BODY_FRAME_SIZE = 48;
const FEATURE_FRAME_SIZE = 48;
const ACCESSORY_FRAME_SIZE = 80;
const COMPOSITE_FRAME_SIZE = 80;
const AVATAR_PREVIEW_SCALE = 2.35;
const AVATAR_ANIMATION_INTERVAL_MS = 200;
const BODY_OFFSET_X = 16;
const BODY_OFFSET_Y = 18;
const VISIBLE_ALPHA_THRESHOLD = 12;
const MIN_VISIBLE_PIXEL_COUNT = 10;
const BODY_COLOR_SWATCHES = [
  { label: "Red", rgb: [237, 43, 52] },
  { label: "Orange", rgb: [255, 138, 5] },
  { label: "Yellow", rgb: [255, 240, 36] },
  { label: "Green", rgb: [124, 227, 10] },
  { label: "Cyan", rgb: [19, 229, 236] },
  { label: "Blue", rgb: [54, 83, 242] },
  { label: "Pink", rgb: [233, 104, 193] },
  { label: "Purple", rgb: [144, 22, 237] },
  { label: "Gray", rgb: [169, 169, 175] },
  { label: "Brown", rgb: [148, 92, 64] },
  { label: "White", rgb: [245, 245, 245] },
  { label: "Beige", rgb: [248, 208, 171] },
];
const AVATAR_ATLAS_CONFIG = {
  body: {
    framePaths: [
      "/assets/avatar-atlas-frames/color_01.png",
      "/assets/avatar-atlas-frames/color_02.png",
    ],
    tileWidth: BODY_FRAME_SIZE,
    tileHeight: BODY_FRAME_SIZE,
  },
  eyes: {
    framePaths: [
      "/assets/avatar-atlas-frames/eyes_01.png",
      "/assets/avatar-atlas-frames/eyes_02.png",
    ],
    tileWidth: FEATURE_FRAME_SIZE,
    tileHeight: FEATURE_FRAME_SIZE,
  },
  mouth: {
    framePaths: [
      "/assets/avatar-atlas-frames/mouth_01.png",
      "/assets/avatar-atlas-frames/mouth_02.png",
    ],
    tileWidth: FEATURE_FRAME_SIZE,
    tileHeight: FEATURE_FRAME_SIZE,
  },
  extra: {
    framePaths: [
      "/assets/avatar-atlas-frames/special_01.png",
      "/assets/avatar-atlas-frames/special_02.png",
    ],
    tileWidth: ACCESSORY_FRAME_SIZE,
    tileHeight: ACCESSORY_FRAME_SIZE,
  },
};
const avatarSlices = {
  body: [],
  eyes: [],
  mouth: [],
  extra: [],
};
const avatarState = {
  bodyIndex: 0,
  eyesIndex: 0,
  mouthIndex: 0,
  extraIndex: 0,
};
const LANDING_PREFERENCES_STORAGE_KEY = "uwzoom.landingPreferences";
let avatarAssetsPromise = null;
let avatarAnimationFrameIndex = 0;
let avatarAnimationTimerId = 0;
const avatarScratchCanvas = document.createElement("canvas");
const avatarScratchContext = avatarScratchCanvas.getContext("2d", { willReadFrequently: true });
const GUEST_NAME_MIN = 100000;
const GUEST_NAME_MAX = 999999;

landingShell?.setAttribute("data-ready", "false");
const landingAvatarReadyPromise = setupLandingSetup();
void flushPendingOnlineLeave();
const landingLeaderboardReadyPromise = renderLandingLeaderboard();
const landingOnlineWinsReadyPromise = renderOnlineWins();
setupPlayStartWarmup();
void finishLandingStartup();

function setupLandingSetup() {
  const params = new URLSearchParams(window.location.search);
  const savedPreferences = loadLandingPreferences();
  const savedAvatarSelection = savedPreferences?.avatar || null;
  const savedPlayerName = savedPreferences?.name || "";
  const selectedAvatarFromUrl = hasAvatarSelectionInSearchParams(params)
    ? readAvatarSelectionFromSearchParams(params)
    : null;
  const initialAvatarSelection = selectedAvatarFromUrl || savedAvatarSelection;

  if (initialAvatarSelection) {
    avatarState.bodyIndex = initialAvatarSelection.body;
    avatarState.eyesIndex = initialAvatarSelection.eyes;
    avatarState.mouthIndex = initialAvatarSelection.mouth;
    avatarState.extraIndex = initialAvatarSelection.extra;
  }

  if (landingPlayerNameInput) {
    const urlPlayerName = normalizePlayerName(params.get("name") || "");
    landingPlayerNameInput.value = urlPlayerName || savedPlayerName;
    landingPlayerNameInput.addEventListener("input", syncPlayLinks);
  }

  playOnlineLink?.addEventListener("click", ensurePlayableName);
  createPrivateRoomLink?.addEventListener("click", ensurePlayableName);

  if (!landingAvatarPreview || !landingAvatarControlButtons.length) {
    syncPlayLinks();
    return Promise.resolve();
  }

  if (landingAvatarRandomizeButton) {
    landingAvatarRandomizeButton.addEventListener("click", () => {
      if (!avatarSlices.body.length) {
        return;
      }

      randomizeAvatarSelection();
      renderAvatarSelection();
    });
  }

  landingAvatarControlButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const control = button.dataset.avatarControl;
      const step = Number(button.dataset.avatarStep || "0");

      if (!control || !Number.isFinite(step) || step === 0) {
        return;
      }

      if (!avatarSlices.body.length) {
        return;
      }

      cycleAvatarOption(control, step);
      renderAvatarSelection();
    });
  });

  return ensureAvatarAssets().catch((error) => {
    console.error("Failed to load avatar atlases.", error);
    drawAvatarFallback();
    syncPlayLinks();
  });
}

async function finishLandingStartup() {
  await Promise.allSettled([
    landingAvatarReadyPromise,
    landingLeaderboardReadyPromise,
    landingOnlineWinsReadyPromise,
  ]);

  landingShell?.setAttribute("data-ready", "true");

  if (landingStartupLoading) {
    window.setTimeout(() => {
      landingStartupLoading.hidden = true;
    }, 220);
  }
}

async function renderLandingLeaderboard() {
  if (!leaderboardList || !leaderboardEmpty || !topStreaksBoard) {
    return;
  }

  await ensureAvatarIconAssets().catch(() => {});

  let entries = [];

  try {
    const payload = await requestJson("/api/leaderboard");
    entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 5) : [];
  } catch {
    entries = [];
  }

  leaderboardList.replaceChildren();

  if (!entries.length) {
    leaderboardList.hidden = true;
    leaderboardEmpty.hidden = false;
    topStreaksBoard.dataset.state = "empty";
    return;
  }

  const fragment = document.createDocumentFragment();

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "landing-leaderboard-entry";
    makeLeaderboardEntryCopyAvatar(item, entry.avatar, `${normalizeLeaderboardName(entry.name)}'s character`);

    const player = document.createElement("div");
    player.className = "landing-leaderboard-player";

    const identity = document.createElement("div");
    identity.className = "landing-leaderboard-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "landing-leaderboard-avatar";
    avatar.width = 34;
    avatar.height = 34;
    drawAvatarIcon(avatar, entry.avatar);

    const rank = document.createElement("span");
    rank.className = "landing-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "landing-leaderboard-name";
    name.textContent = normalizeLeaderboardName(entry.name);

    const copy = document.createElement("div");
    copy.className = "landing-leaderboard-copy";
    copy.append(rank, name);

    const metrics = document.createElement("div");
    metrics.className = "landing-leaderboard-metrics";

    const score = document.createElement("strong");
    score.className = "landing-leaderboard-score";
    score.textContent = `${normalizeScore(entry.score)} in a row`;

    const duration = document.createElement("span");
    duration.className = "landing-leaderboard-time";

    const formattedDuration = formatDuration(entry.durationMs);

    if (formattedDuration) {
      duration.textContent = `in ${formattedDuration}`;
      metrics.append(score, duration);
    } else {
      metrics.append(score);
    }

    identity.append(avatar, copy);
    player.append(identity);
    item.append(player, metrics);
    fragment.append(item);
  });

  leaderboardList.append(fragment);
  leaderboardList.hidden = false;
  leaderboardEmpty.hidden = true;
  topStreaksBoard.dataset.state = "ready";
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeLeaderboardName(value) {
  const normalized = censorProfanity(value, { maxLength: 32 });

  return normalized || "Anonymous";
}

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
}

function formatDuration(value) {
  const durationMs = normalizeDurationMs(value);

  if (!Number.isFinite(durationMs)) {
    return "";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function renderOnlineWins() {
  if (!onlineWinsList || !onlineWinsEmpty || !onlineWinsBoard) {
    return;
  }

  await ensureAvatarIconAssets().catch(() => {});

  let leaders = [];

  try {
    const payload = await requestJson("/api/online-wins");
    leaders = Array.isArray(payload.leaders) ? payload.leaders : [];
  } catch {
    leaders = [];
  }

  onlineWinsList.replaceChildren();

  if (!leaders.length) {
    onlineWinsList.hidden = true;
    onlineWinsEmpty.hidden = false;
    onlineWinsBoard.dataset.state = "empty";
    return;
  }

  const fragment = document.createDocumentFragment();

  leaders.slice(0, 5).forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "landing-leaderboard-entry";
    makeLeaderboardEntryCopyAvatar(item, entry.avatar, `${normalizeLeaderboardName(entry.name)}'s character`);

    const player = document.createElement("div");
    player.className = "landing-leaderboard-player";

    const identity = document.createElement("div");
    identity.className = "landing-leaderboard-identity";

    const avatar = document.createElement("canvas");
    avatar.className = "landing-leaderboard-avatar";
    avatar.width = 34;
    avatar.height = 34;
    drawAvatarIcon(avatar, entry.avatar);

    const rank = document.createElement("span");
    rank.className = "landing-leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "landing-leaderboard-name";
    name.textContent = normalizeLeaderboardName(entry.name);

    const copy = document.createElement("div");
    copy.className = "landing-leaderboard-copy";
    copy.append(rank, name);

    const value = document.createElement("strong");
    value.className = "landing-leaderboard-score";

    const wins = normalizeScore(entry.wins);
    value.textContent = `${wins} win${wins === 1 ? "" : "s"}`;

    identity.append(avatar, copy);
    player.append(identity);
    item.append(player, value);
    fragment.append(item);
  });

  onlineWinsList.append(fragment);
  onlineWinsList.hidden = false;
  onlineWinsEmpty.hidden = true;
  onlineWinsBoard.dataset.state = "ready";
}

function makeLeaderboardEntryCopyAvatar(item, avatarSelection, label) {
  if (!item) {
    return;
  }

  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `Copy ${label}`);
  item.title = `Copy ${label}`;

  const applySelection = () => {
    copyAvatarSelection(avatarSelection);
  };

  item.addEventListener("click", applySelection);
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    applySelection();
  });
}

function copyAvatarSelection(selection) {
  const normalized = normalizeAvatarSelection(selection);

  avatarState.bodyIndex = normalized.body;
  avatarState.eyesIndex = normalized.eyes;
  avatarState.mouthIndex = normalized.mouth;
  avatarState.extraIndex = normalized.extra;

  renderAvatarSelection();
}

function setupPlayStartWarmup() {
  const warmupLinks = [startPlayingLink, playOnlineLink].filter(Boolean);

  if (!warmupLinks.length) {
    return;
  }

  const triggerWarmup = () => {
    if (!playStartWarmupPromise) {
      playStartWarmupPromise = warmPlayStart();
    }
  };

  warmupLinks.forEach((link) => {
    link.addEventListener("pointerenter", triggerWarmup, { once: true });
    link.addEventListener("focus", triggerWarmup, { once: true });
    link.addEventListener("touchstart", triggerWarmup, {
      once: true,
      passive: true,
    });
  });
}

async function warmPlayStart() {
  const requests = ["/api/approved-images", "/api/word-bank", "/api/leaderboard"].map((url) =>
    fetch(url, {
      method: "GET",
      credentials: "same-origin",
    })
      .then((response) => response.text().catch(() => ""))
      .catch(() => null),
  );

  await Promise.allSettled(requests);
}

function renderAvatarSelection() {
  const selection = getAvatarSelection();

  if (landingAvatarPreview) {
    landingAvatarPreview.setAttribute(
      "aria-label",
      `${selection.body.label} avatar with ${selection.eyes.label}, ${selection.mouth.label}, and ${selection.extra.label}`,
    );
  }

  drawLandingAvatar(selection);
  syncPlayLinks();
}

function cycleAvatarOption(control, step) {
  const key = `${control}Index`;
  const optionList = resolveAvatarOptionList(control);

  if (!optionList.length || !Object.prototype.hasOwnProperty.call(avatarState, key)) {
    return;
  }

  avatarState[key] = wrapIndex(avatarState[key] + step, optionList.length);
}

function randomizeAvatarSelection() {
  const previousState = { ...avatarState };

  avatarState.bodyIndex = pickRandomAvatarIndex(avatarSlices.body.length, previousState.bodyIndex);
  avatarState.eyesIndex = pickRandomAvatarIndex(avatarSlices.eyes.length, previousState.eyesIndex);
  avatarState.mouthIndex = pickRandomAvatarIndex(avatarSlices.mouth.length, previousState.mouthIndex);
  avatarState.extraIndex = pickRandomAvatarIndex(avatarSlices.extra.length, previousState.extraIndex);

  if (
    avatarState.bodyIndex === previousState.bodyIndex &&
    avatarState.eyesIndex === previousState.eyesIndex &&
    avatarState.mouthIndex === previousState.mouthIndex &&
    avatarState.extraIndex === previousState.extraIndex
  ) {
    avatarState.eyesIndex = wrapIndex(avatarState.eyesIndex + 1, avatarSlices.eyes.length);
  }
}

function resolveAvatarOptionList(control) {
  if (control === "body") {
    return avatarSlices.body;
  }

  if (control === "eyes") {
    return avatarSlices.eyes;
  }

  if (control === "mouth") {
    return avatarSlices.mouth;
  }

  if (control === "extra") {
    return avatarSlices.extra;
  }

  return [];
}

function getAvatarSelection() {
  return {
    body: avatarSlices.body[avatarState.bodyIndex] || createFallbackOption("Body"),
    eyes: avatarSlices.eyes[avatarState.eyesIndex] || createFallbackOption("Eyes"),
    mouth: avatarSlices.mouth[avatarState.mouthIndex] || createFallbackOption("Mouth"),
    extra: avatarSlices.extra[avatarState.extraIndex] || createFallbackOption("None"),
  };
}

function syncPlayLinks() {
  saveLandingPreferences();

  if (startPlayingLink) {
    startPlayingLink.href = buildDestinationHref("/play/");
  }

  if (playOnlineLink) {
    playOnlineLink.href = buildDestinationHref("/play-online/");
  }

  if (createPrivateRoomLink) {
    createPrivateRoomLink.href = buildDestinationHref("/play-online/", {
      createPrivateRoom: true,
    });
  }
}

function ensurePlayableName() {
  if (!landingPlayerNameInput) {
    return "";
  }

  const currentName = normalizePlayerName(landingPlayerNameInput.value);

  if (currentName) {
    landingPlayerNameInput.value = currentName;
    syncPlayLinks();
    return currentName;
  }

  const guestName = createGuestName();
  landingPlayerNameInput.value = guestName;
  syncPlayLinks();
  return guestName;
}

function buildDestinationHref(pathname, options = {}) {
  const { createPrivateRoom = false } = options;
  const params = new URLSearchParams();
  const name = normalizePlayerName(landingPlayerNameInput?.value || "");

  if (name) {
    params.set("name", name);
  }

  if (pathname === "/play-online/") {
    params.set("autoplay", "1");

    if (createPrivateRoom) {
      params.set("createPrivateRoom", "1");
    }
  }

  writeAvatarSelectionToSearchParams(params, {
    body: avatarState.bodyIndex,
    eyes: avatarState.eyesIndex,
    mouth: avatarState.mouthIndex,
    extra: avatarState.extraIndex,
  });

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function drawLandingAvatar(selection) {
  if (!landingAvatarPreview || !landingAvatarContext) {
    return;
  }

  const logicalWidth = landingAvatarPreview.width / AVATAR_PREVIEW_SCALE;
  const logicalHeight = landingAvatarPreview.height / AVATAR_PREVIEW_SCALE;
  const originX = Math.round((logicalWidth - COMPOSITE_FRAME_SIZE) / 2);
  const originY = Math.round((logicalHeight - COMPOSITE_FRAME_SIZE) / 2) - 9;

  landingAvatarContext.clearRect(0, 0, landingAvatarPreview.width, landingAvatarPreview.height);
  landingAvatarContext.save();
  landingAvatarContext.imageSmoothingEnabled = false;
  landingAvatarContext.scale(AVATAR_PREVIEW_SCALE, AVATAR_PREVIEW_SCALE);
  landingAvatarContext.translate(originX, originY);

  drawAvatarSlice(landingAvatarContext, selection.body, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawAvatarSlice(landingAvatarContext, selection.eyes, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawAvatarSlice(landingAvatarContext, selection.mouth, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawAvatarSlice(landingAvatarContext, selection.extra, 0, 0);

  landingAvatarContext.restore();
}

function drawAvatarSlice(context, option, frameOffsetX, frameOffsetY) {
  const frame = getAnimatedAvatarFrame(option);

  if (!frame?.canvas) {
    return;
  }

  context.drawImage(
    frame.canvas,
    frameOffsetX + frame.offsetX,
    frameOffsetY + frame.offsetY,
  );
}

function getAnimatedAvatarFrame(option) {
  if (!option?.frames?.length) {
    return option?.canvas ? option : null;
  }

  return option.frames[avatarAnimationFrameIndex % option.frames.length] || option.frames[0] || null;
}

async function ensureAvatarAssets() {
  if (avatarAssetsPromise) {
    return avatarAssetsPromise;
  }

  avatarAssetsPromise = Promise.all([
    loadAtlasSlices("body", AVATAR_ATLAS_CONFIG.body),
    loadAtlasSlices("eyes", AVATAR_ATLAS_CONFIG.eyes),
    loadAtlasSlices("mouth", AVATAR_ATLAS_CONFIG.mouth),
    loadAtlasSlices("extra", AVATAR_ATLAS_CONFIG.extra),
  ]).then(([body, eyes, mouth, extra]) => {
    avatarSlices.body = body.map((slice, index) => ({
      ...slice.frames[0],
      frames: slice.frames,
      label: describeBodyVariant(slice.frames[0], index),
    }));
    avatarSlices.eyes = eyes.map((slice, index) => ({
      ...slice.frames[0],
      frames: slice.frames,
      label: `Eyes ${index + 1}`,
    }));
    avatarSlices.mouth = mouth.map((slice, index) => ({
      ...slice.frames[0],
      frames: slice.frames,
      label: `Mouth ${index + 1}`,
    }));
    avatarSlices.extra = [
      { label: "None", canvas: null, frames: [], offsetX: 0, offsetY: 0 },
      ...extra.map((slice, index) => ({
        ...slice.frames[0],
        frames: slice.frames,
        label: `Accessory ${index + 1}`,
      })),
    ];

    normalizeAvatarIndexes();
    startAvatarAnimation();
    renderAvatarSelection();
  });

  return avatarAssetsPromise;
}

async function loadAtlasSlices(role, config) {
  const atlasFrames = await Promise.all(
    config.framePaths.map((path) => loadStaticAtlasImage(path)),
  );

  return combineAnimatedAtlasOptions(
    atlasFrames,
    config.tileWidth,
    config.tileHeight,
    role,
  );
}

async function loadStaticAtlasImage(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`Failed to load atlas: ${path}`);
  }

  const blob = await response.blob();

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to the Image element path.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode atlas: ${path}`));
    };
    image.src = objectUrl;
  });
}

function combineAnimatedAtlasOptions(atlasFrames, tileWidth, tileHeight, role) {
  if (!atlasFrames.length) {
    return [];
  }

  const frameOptionSets = atlasFrames.map((atlasFrame) =>
    sliceAtlasIntoFrameOptions(atlasFrame, tileWidth, tileHeight, role),
  );
  const optionCount = Math.max(...frameOptionSets.map((options) => options.length), 0);
  const combined = [];

  for (let index = 0; index < optionCount; index += 1) {
    const frames = frameOptionSets
      .map((options) => options[index])
      .filter(Boolean);

    if (!frames.length) {
      continue;
    }

    combined.push({
      role,
      frames,
    });
  }

  return combined;
}

function sliceAtlasIntoFrameOptions(atlasImage, tileWidth, tileHeight, role) {
  if (!avatarScratchContext) {
    return [];
  }

  const options = [];
  const columns = Math.floor(atlasImage.width / tileWidth);
  const rows = Math.floor(atlasImage.height / tileHeight);

  avatarScratchCanvas.width = tileWidth;
  avatarScratchCanvas.height = tileHeight;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sourceX = column * tileWidth;
      const sourceY = row * tileHeight;

      avatarScratchContext.clearRect(0, 0, tileWidth, tileHeight);
      avatarScratchContext.drawImage(
        atlasImage,
        sourceX,
        sourceY,
        tileWidth,
        tileHeight,
        0,
        0,
        tileWidth,
        tileHeight,
      );

      const imageData = avatarScratchContext.getImageData(0, 0, tileWidth, tileHeight);
      const bounds = findVisibleBounds(imageData);

      if (!bounds) {
        continue;
      }

      const optionCanvas = document.createElement("canvas");
      optionCanvas.width = bounds.width;
      optionCanvas.height = bounds.height;
      const optionContext = optionCanvas.getContext("2d");

      if (!optionContext) {
        continue;
      }

      optionContext.imageSmoothingEnabled = false;
      optionContext.drawImage(
        atlasImage,
        sourceX + bounds.left,
        sourceY + bounds.top,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );

      options.push({
        canvas: optionCanvas,
        offsetX: bounds.left,
        offsetY: bounds.top,
        frameWidth: tileWidth,
        frameHeight: tileHeight,
        role,
      });
    }
  }

  return options;
}

function startAvatarAnimation() {
  if (avatarAnimationTimerId || typeof window === "undefined") {
    return;
  }

  avatarAnimationTimerId = window.setInterval(() => {
    avatarAnimationFrameIndex = (avatarAnimationFrameIndex + 1) % 2;
    renderAvatarSelection();
  }, AVATAR_ANIMATION_INTERVAL_MS);
}

function findVisibleBounds(imageData) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];

      if (alpha <= VISIBLE_ALPHA_THRESHOLD) {
        continue;
      }

      visiblePixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (visiblePixelCount < MIN_VISIBLE_PIXEL_COUNT || maxX < minX || maxY < minY) {
    return null;
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function describeBodyVariant(slice, index) {
  const averageColor = averageVisibleColor(slice.canvas);

  if (!averageColor) {
    return `Body ${index + 1}`;
  }

  const nearest = BODY_COLOR_SWATCHES.reduce((best, swatch) => {
    const distance =
      (averageColor[0] - swatch.rgb[0]) ** 2 +
      (averageColor[1] - swatch.rgb[1]) ** 2 +
      (averageColor[2] - swatch.rgb[2]) ** 2;

    if (!best || distance < best.distance) {
      return { label: swatch.label, distance };
    }

    return best;
  }, null);

  return nearest?.label || `Body ${index + 1}`;
}

function averageVisibleColor(sourceCanvas) {
  const sourceContext = sourceCanvas?.getContext?.("2d", { willReadFrequently: true });

  if (!sourceContext) {
    return null;
  }

  const { data, width, height } = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];

      if (alpha <= 180) {
        continue;
      }

      const pixelRed = data[offset];
      const pixelGreen = data[offset + 1];
      const pixelBlue = data[offset + 2];

      // Ignore the dark outline so labels reflect the fill color.
      if (pixelRed < 40 && pixelGreen < 40 && pixelBlue < 40) {
        continue;
      }

      red += pixelRed;
      green += pixelGreen;
      blue += pixelBlue;
      count += 1;
    }
  }

  if (!count) {
    return null;
  }

  return [red / count, green / count, blue / count];
}

function normalizeAvatarIndexes() {
  avatarState.bodyIndex = wrapIndex(avatarState.bodyIndex, avatarSlices.body.length);
  avatarState.eyesIndex = wrapIndex(avatarState.eyesIndex, avatarSlices.eyes.length);
  avatarState.mouthIndex = wrapIndex(avatarState.mouthIndex, avatarSlices.mouth.length);
  avatarState.extraIndex = wrapIndex(avatarState.extraIndex, avatarSlices.extra.length);
}

function createFallbackOption(label) {
  return {
    label,
    canvas: null,
    offsetX: 0,
    offsetY: 0,
  };
}

function drawAvatarFallback() {
  if (!landingAvatarPreview || !landingAvatarContext) {
    return;
  }

  landingAvatarContext.clearRect(0, 0, landingAvatarPreview.width, landingAvatarPreview.height);
  landingAvatarContext.save();
  landingAvatarContext.fillStyle = "rgba(17, 17, 17, 0.08)";
  landingAvatarContext.beginPath();
  landingAvatarContext.arc(
    landingAvatarPreview.width / 2,
    landingAvatarPreview.height / 2,
    36,
    0,
    Math.PI * 2,
  );
  landingAvatarContext.fill();
  landingAvatarContext.restore();
}

function normalizePlayerName(value) {
  return censorProfanity(value, { maxLength: 32 });
}

function createGuestName() {
  const randomNumber =
    Math.floor(Math.random() * (GUEST_NAME_MAX - GUEST_NAME_MIN + 1)) + GUEST_NAME_MIN;
  return `guest_${randomNumber}`;
}

function isGeneratedGuestName(value) {
  return /^guest_\d+$/iu.test(String(value || "").trim());
}

function hasAvatarSelectionInSearchParams(params) {
  return Object.values(AVATAR_QUERY_KEYS).some((key) => params.has(key));
}

function loadLandingPreferences() {
  try {
    const rawValue = window.localStorage.getItem(LANDING_PREFERENCES_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    const params = new URLSearchParams();

    if (parsedValue?.avatar && typeof parsedValue.avatar === "object") {
      writeAvatarSelectionToSearchParams(params, parsedValue.avatar);
    }

    return {
      name: normalizeStoredPlayerName(parsedValue?.name),
      avatar: hasAvatarSelectionInSearchParams(params)
        ? readAvatarSelectionFromSearchParams(params)
        : null,
    };
  } catch {
    return null;
  }
}

function saveLandingPreferences() {
  try {
    const normalizedName = normalizeStoredPlayerName(landingPlayerNameInput?.value || "");
    window.localStorage.setItem(
      LANDING_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...(normalizedName ? { name: normalizedName } : {}),
        avatar: {
          body: avatarState.bodyIndex,
          eyes: avatarState.eyesIndex,
          mouth: avatarState.mouthIndex,
          extra: avatarState.extraIndex,
        },
      }),
    );
  } catch {
    // Ignore storage failures so the start screen still works normally.
  }
}

function normalizeStoredPlayerName(value) {
  const normalizedName = normalizePlayerName(value);

  if (!normalizedName || isGeneratedGuestName(normalizedName)) {
    return "";
  }

  return normalizedName;
}

function wrapIndex(index, length) {
  if (!length) {
    return 0;
  }

  return (index % length + length) % length;
}

function pickRandomAvatarIndex(length, currentIndex) {
  if (!length) {
    return 0;
  }

  if (length === 1) {
    return 0;
  }

  let nextIndex = Math.floor(Math.random() * length);

  if (nextIndex === currentIndex) {
    nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (length - 1))) % length;
  }

  return nextIndex;
}
