import { handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import {
  createPresignedUpload,
  getStorageConfig,
  validateImageSize,
  validateImageType,
} from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  await requireNotBanned(event, "uploading images");

  const body = parseJsonBody(event);
  validateImageType(body.fileType);
  validateImageSize(body.fileSize);

  const upload = await createPresignedUpload({
    filename: body.filename,
    fileType: body.fileType,
  });

  return json(200, {
    ...upload,
    maxUploadMb: getStorageConfig().maxUploadMb,
  });
});
