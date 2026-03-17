import { HttpError } from "./http.js";
import { buildDemoImages } from "./demo-images.js";
import { createSignedDownloadUrl, getJson, listJson, putJson, storageConfigured } from "./storage.js";

const DEMO_IMAGE_SETTINGS_KEY = "app/admin/demo-images.json";
const DEMO_SOURCE_LABEL = "Starter image";
const APPROVED_SOURCE_LABEL = "Approved upload";
const DEMO_UPLOADER_NAME = "Built-in starter set";
const DEMO_IMAGE_IDS = new Set(buildDemoImages("").map((image) => image.id));

export function isDemoCatalogImage(id) {
  return DEMO_IMAGE_IDS.has(String(id || "").trim());
}

export async function listPlayableCatalogImages(origin) {
  const [demoImages, approvedImages] = await Promise.all([
    listManagedDemoImages(origin),
    listStoredApprovedImages(),
  ]);

  return [...demoImages, ...approvedImages];
}

export async function listAdminCatalogImages(origin) {
  const [demoImages, approvedImages] = await Promise.all([
    listManagedDemoImages(origin, {
      forAdmin: true,
    }),
    listStoredApprovedImages({
      forAdmin: true,
    }),
  ]);

  return [...demoImages, ...approvedImages];
}

export async function listCatalogAnswerEntries() {
  const [demoImages, approvedImages] = await Promise.all([
    listManagedDemoImages(""),
    listStoredApprovedImages(),
  ]);

  return [...demoImages, ...approvedImages].map((image) => ({
    id: image.id,
    source: image.source,
    answer: image.answer,
    acceptedAnswers: image.acceptedAnswers || [],
  }));
}

export async function updateDemoCatalogImage(origin, id, fields) {
  const normalizedId = String(id || "").trim();

  if (!isDemoCatalogImage(normalizedId)) {
    throw new HttpError(404, "That starter image does not exist.");
  }

  const answer = normalizeAnswer(fields.answer);

  if (!answer) {
    throw new HttpError(400, "The main answer is required.");
  }

  const acceptedAnswers = normalizeAcceptedAnswers(fields.acceptedAnswers, answer);
  const settings = await loadDemoImageSettings();
  const updatedAt = new Date().toISOString();

  settings[normalizedId] = {
    ...settings[normalizedId],
    answer,
    acceptedAnswers,
    deleted: false,
    updatedAt,
  };

  await saveDemoImageSettings(settings);

  const baseImage = buildDemoImages(origin).find((image) => image.id === normalizedId);

  if (!baseImage) {
    throw new HttpError(404, "That starter image does not exist.");
  }

  return {
    ...baseImage,
    answer,
    acceptedAnswers,
    source: "demo",
    sourceLabel: DEMO_SOURCE_LABEL,
    previewUrl: baseImage.imageUrl,
    uploaderName: DEMO_UPLOADER_NAME,
    submitterIp: "",
    approvedAt: updatedAt,
  };
}

export async function deleteDemoCatalogImage(id) {
  const normalizedId = String(id || "").trim();

  if (!isDemoCatalogImage(normalizedId)) {
    throw new HttpError(404, "That starter image does not exist.");
  }

  const settings = await loadDemoImageSettings();

  settings[normalizedId] = {
    ...settings[normalizedId],
    deleted: true,
    deletedAt: new Date().toISOString(),
  };

  await saveDemoImageSettings(settings);
}

async function listManagedDemoImages(origin, options = {}) {
  const { forAdmin = false } = options;
  const settings = await loadDemoImageSettings();
  const baseImages = buildDemoImages(origin);

  return baseImages
    .map((baseImage) => {
      const override = settings[baseImage.id] || {};

      if (override.deleted) {
        return null;
      }

      const answer = normalizeAnswer(override.answer) || baseImage.answer;
      const acceptedAnswers = hasOwnProperty(override, "acceptedAnswers")
        ? normalizeAcceptedAnswers(override.acceptedAnswers, answer)
        : normalizeAcceptedAnswers(baseImage.acceptedAnswers || [], answer);

      if (forAdmin) {
        return {
          ...baseImage,
          answer,
          acceptedAnswers,
          source: "demo",
          sourceLabel: DEMO_SOURCE_LABEL,
          previewUrl: baseImage.imageUrl,
          uploaderName: DEMO_UPLOADER_NAME,
          submitterIp: "",
          approvedAt: override.updatedAt || "",
        };
      }

      return {
        ...baseImage,
        answer,
        acceptedAnswers,
        source: "demo",
      };
    })
    .filter(Boolean);
}

async function listStoredApprovedImages(options = {}) {
  const { forAdmin = false } = options;

  if (!storageConfigured()) {
    return [];
  }

  const approved = await listJson("approved/meta/");

  const images = await Promise.all(
    approved.map(async (item) => {
      if (!item?.id || !item?.imageKey || !item?.answer) {
        return null;
      }

      if (forAdmin) {
        return {
          ...item,
          source: "approved",
          sourceLabel: APPROVED_SOURCE_LABEL,
          previewUrl: await createSignedDownloadUrl(item.imageKey, 1800),
        };
      }

      return {
        id: item.id,
        answer: item.answer,
        acceptedAnswers: item.acceptedAnswers || [],
        imageUrl: await createSignedDownloadUrl(item.imageKey),
        focusX: item.focusX || 50,
        focusY: item.focusY || 50,
        source: "approved",
      };
    }),
  );

  return images.filter(Boolean);
}

async function loadDemoImageSettings() {
  if (!storageConfigured()) {
    return {};
  }

  const document = await getJson(DEMO_IMAGE_SETTINGS_KEY);
  const imageSettings = document?.images;

  if (!imageSettings || typeof imageSettings !== "object") {
    return {};
  }

  const normalized = {};

  for (const [id, value] of Object.entries(imageSettings)) {
    if (!isDemoCatalogImage(id) || !value || typeof value !== "object") {
      continue;
    }

    normalized[id] = {
      answer: normalizeAnswer(value.answer),
      acceptedAnswers: normalizeAcceptedAnswers(value.acceptedAnswers, value.answer),
      deleted: Boolean(value.deleted),
      updatedAt: String(value.updatedAt || ""),
      deletedAt: String(value.deletedAt || ""),
    };
  }

  return normalized;
}

async function saveDemoImageSettings(settings) {
  await putJson(DEMO_IMAGE_SETTINGS_KEY, {
    images: settings,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizeAcceptedAnswers(value, mainAnswer = "") {
  const parsed = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map((item) => item.trim());

  const normalizedMain = normalizeComparable(mainAnswer);
  const seen = new Set();
  const unique = [];

  for (const entry of parsed) {
    const trimmed = normalizeAnswer(entry);
    const comparable = normalizeComparable(trimmed);

    if (!trimmed || !comparable || comparable === normalizedMain || seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    unique.push(trimmed);
  }

  return unique;
}

function normalizeComparable(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}
