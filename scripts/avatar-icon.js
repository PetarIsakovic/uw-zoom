import { normalizeAvatarSelection } from "/shared/avatar-selection.js";

const BODY_FRAME_SIZE = 48;
const FEATURE_FRAME_SIZE = 48;
const ACCESSORY_FRAME_SIZE = 80;
const COMPOSITE_FRAME_SIZE = 80;
const BODY_OFFSET_X = 16;
const BODY_OFFSET_Y = 18;
const VISIBLE_ALPHA_THRESHOLD = 12;
const MIN_VISIBLE_PIXEL_COUNT = 10;
const AVATAR_ICON_ANIMATION_INTERVAL_MS = 200;

const ATLAS_CONFIG = {
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

const scratchCanvas = document.createElement("canvas");
const scratchContext = scratchCanvas.getContext("2d", { willReadFrequently: true });
const animatedIcons = new Map();

let assetsPromise = null;
let cachedAssets = null;
let avatarIconAnimationFrameIndex = 0;
let avatarIconAnimationTimerId = 0;

export async function ensureAvatarIconAssets() {
  if (cachedAssets) {
    return cachedAssets;
  }

  if (assetsPromise) {
    return assetsPromise;
  }

  assetsPromise = Promise.all([
    loadAnimatedAtlasOptions(ATLAS_CONFIG.body),
    loadAnimatedAtlasOptions(ATLAS_CONFIG.eyes),
    loadAnimatedAtlasOptions(ATLAS_CONFIG.mouth),
    loadAnimatedAtlasOptions(ATLAS_CONFIG.extra),
  ]).then(([body, eyes, mouth, extra]) => {
    cachedAssets = {
      body,
      eyes,
      mouth,
      extra: [{ frames: [], offsetX: 0, offsetY: 0 }, ...extra],
    };

    startAvatarIconAnimation();
    return cachedAssets;
  });

  return assetsPromise;
}

export function drawAvatarIcon(canvas, selection) {
  if (!canvas) {
    return;
  }

  const normalized = normalizeAvatarSelection(selection);
  animatedIcons.set(canvas, normalized);

  if (!cachedAssets) {
    void ensureAvatarIconAssets()
      .then(() => {
        renderAvatarCanvas(canvas, normalized);
      })
      .catch(() => {
        animatedIcons.delete(canvas);
      });
    return;
  }

  renderAvatarCanvas(canvas, normalized);
  startAvatarIconAnimation();
}

async function loadAnimatedAtlasOptions(config) {
  const atlasFrames = await Promise.all(config.framePaths.map((path) => loadImage(path)));
  return combineAnimatedAtlasOptions(atlasFrames, config.tileWidth, config.tileHeight);
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load avatar icon atlas: ${path}`));
    image.src = path;
  });
}

function combineAnimatedAtlasOptions(atlasFrames, tileWidth, tileHeight) {
  if (!atlasFrames.length) {
    return [];
  }

  const frameOptionSets = atlasFrames.map((atlasFrame) =>
    sliceAtlasIntoFrameOptions(atlasFrame, tileWidth, tileHeight),
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
      frames,
      offsetX: frames[0].offsetX,
      offsetY: frames[0].offsetY,
    });
  }

  return combined;
}

function sliceAtlasIntoFrameOptions(atlasImage, tileWidth, tileHeight) {
  if (!scratchContext) {
    return [];
  }

  const options = [];
  const columns = Math.floor(atlasImage.width / tileWidth);
  const rows = Math.floor(atlasImage.height / tileHeight);

  scratchCanvas.width = tileWidth;
  scratchCanvas.height = tileHeight;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sourceX = column * tileWidth;
      const sourceY = row * tileHeight;

      scratchContext.clearRect(0, 0, tileWidth, tileHeight);
      scratchContext.drawImage(
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

      const imageData = scratchContext.getImageData(0, 0, tileWidth, tileHeight);
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
      });
    }
  }

  return options;
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

      if (data[offset + 3] <= VISIBLE_ALPHA_THRESHOLD) {
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

function startAvatarIconAnimation() {
  if (avatarIconAnimationTimerId || typeof window === "undefined") {
    return;
  }

  avatarIconAnimationTimerId = window.setInterval(() => {
    avatarIconAnimationFrameIndex = (avatarIconAnimationFrameIndex + 1) % 2;
    redrawAnimatedIcons();
  }, AVATAR_ICON_ANIMATION_INTERVAL_MS);
}

function redrawAnimatedIcons() {
  if (!cachedAssets) {
    return;
  }

  for (const [canvas, selection] of animatedIcons.entries()) {
    if (!canvas?.isConnected) {
      animatedIcons.delete(canvas);
      continue;
    }

    renderAvatarCanvas(canvas, selection);
  }

  if (!animatedIcons.size && avatarIconAnimationTimerId) {
    window.clearInterval(avatarIconAnimationTimerId);
    avatarIconAnimationTimerId = 0;
  }
}

function renderAvatarCanvas(canvas, selection) {
  if (!canvas || !cachedAssets) {
    return;
  }

  const context = canvas.getContext?.("2d");

  if (!context) {
    return;
  }

  const normalized = normalizeAvatarSelection(selection);
  const body = pickOptionFrame(cachedAssets.body, normalized.body);
  const eyes = pickOptionFrame(cachedAssets.eyes, normalized.eyes);
  const mouth = pickOptionFrame(cachedAssets.mouth, normalized.mouth);
  const extra = pickOptionFrame(cachedAssets.extra, normalized.extra);
  const scale = Math.max(0.0001, Math.min(canvas.width, canvas.height) / COMPOSITE_FRAME_SIZE);
  const drawWidth = COMPOSITE_FRAME_SIZE * scale;
  const drawHeight = COMPOSITE_FRAME_SIZE * scale;
  const originX = (canvas.width - drawWidth) / 2;
  const originY = (canvas.height - drawHeight) / 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(originX, originY);
  context.scale(scale, scale);

  drawSlice(context, body, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawSlice(context, eyes, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawSlice(context, mouth, BODY_OFFSET_X, BODY_OFFSET_Y);
  drawSlice(context, extra, 0, 0);

  context.restore();
}

function pickOptionFrame(options, index) {
  if (!Array.isArray(options) || !options.length) {
    return null;
  }

  const normalizedIndex = ((index % options.length) + options.length) % options.length;
  const option = options[normalizedIndex] || options[0] || null;

  if (!option?.frames?.length) {
    return option;
  }

  return option.frames[avatarIconAnimationFrameIndex % option.frames.length] || option.frames[0] || null;
}

function drawSlice(context, option, frameOffsetX, frameOffsetY) {
  if (!option?.canvas) {
    return;
  }

  context.drawImage(
    option.canvas,
    frameOffsetX + option.offsetX,
    frameOffsetY + option.offsetY,
  );
}
