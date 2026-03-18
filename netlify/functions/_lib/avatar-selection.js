export const DEFAULT_AVATAR_SELECTION = Object.freeze({
  body: 0,
  eyes: 0,
  mouth: 0,
  extra: 0,
});

const MAX_AVATAR_INDEX = 999;

export function normalizeAvatarSelection(value) {
  return {
    body: normalizeAvatarIndex(value?.body, DEFAULT_AVATAR_SELECTION.body),
    eyes: normalizeAvatarIndex(value?.eyes, DEFAULT_AVATAR_SELECTION.eyes),
    mouth: normalizeAvatarIndex(value?.mouth, DEFAULT_AVATAR_SELECTION.mouth),
    extra: normalizeAvatarIndex(value?.extra, DEFAULT_AVATAR_SELECTION.extra),
  };
}

function normalizeAvatarIndex(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), MAX_AVATAR_INDEX);
}
