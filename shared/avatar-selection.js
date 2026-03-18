export const AVATAR_QUERY_KEYS = Object.freeze({
  body: "avatarBody",
  eyes: "avatarEyes",
  mouth: "avatarMouth",
  extra: "avatarExtra",
});

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

export function readAvatarSelectionFromSearchParams(params) {
  return normalizeAvatarSelection({
    body: params?.get?.(AVATAR_QUERY_KEYS.body),
    eyes: params?.get?.(AVATAR_QUERY_KEYS.eyes),
    mouth: params?.get?.(AVATAR_QUERY_KEYS.mouth),
    extra: params?.get?.(AVATAR_QUERY_KEYS.extra),
  });
}

export function writeAvatarSelectionToSearchParams(params, selection) {
  const target = params instanceof URLSearchParams ? params : new URLSearchParams();
  const normalized = normalizeAvatarSelection(selection);

  target.set(AVATAR_QUERY_KEYS.body, String(normalized.body));
  target.set(AVATAR_QUERY_KEYS.eyes, String(normalized.eyes));
  target.set(AVATAR_QUERY_KEYS.mouth, String(normalized.mouth));
  target.set(AVATAR_QUERY_KEYS.extra, String(normalized.extra));

  return target;
}

function normalizeAvatarIndex(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), MAX_AVATAR_INDEX);
}
