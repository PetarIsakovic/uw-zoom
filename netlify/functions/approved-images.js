import { requireNotBanned } from "./_lib/bans.js";
import { getOrigin, handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { listPlayableCatalogImages } from "./_lib/image-catalog.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);
  await requireNotBanned(event, "playing the game");

  const origin = getOrigin(event);
  const images = await listPlayableCatalogImages(origin);

  return json(200, {
    images,
    source: images.every((image) => image.source === "demo") ? "demo" : "catalog",
  });
});
