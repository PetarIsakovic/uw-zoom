import { buildDemoImages } from "./_lib/demo-images.js";
import { getOrigin, handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { createSignedDownloadUrl, listJson, storageConfigured } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);

  const origin = getOrigin(event);

  if (!storageConfigured()) {
    return json(200, {
      images: buildDemoImages(origin),
      source: "demo",
    });
  }

  const approved = await listJson("approved/meta/");

  if (!approved.length) {
    return json(200, {
      images: buildDemoImages(origin),
      source: "demo",
    });
  }

  const images = (
    await Promise.all(
      approved.map(async (item) => {
        if (!item?.id || !item?.imageKey || !item?.answer) {
          return null;
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
    )
  ).filter(Boolean);

  return json(200, {
    images: images.length ? images : buildDemoImages(origin),
    source: images.length ? "approved" : "demo",
  });
});
