import { requireAdmin } from "./_lib/admin.js";
import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { createSignedDownloadUrl, listJson } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);
  requireAdmin(event);

  const pending = await listJson("pending/meta/");

  const submissions = await Promise.all(
    pending.map(async (item) => ({
      ...item,
      previewUrl: await createSignedDownloadUrl(item.imageKey, 1800),
    })),
  );

  return json(200, {
    submissions,
  });
});
