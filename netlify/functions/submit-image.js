import { HttpError, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { requireNotBanned } from "./_lib/bans.js";
import { getClientIp } from "./_lib/ip.js";
import { requireRateLimit } from "./_lib/rate-limit.js";
import {
  deleteObject,
  getObjectMetadata,
  getStorageConfig,
  pendingMetadataKey,
  putJson,
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
  await requireRateLimit(event, "submit-image", {
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
    message: "Too many upload submissions from this connection. Try again in a few minutes.",
  });

  const body = parseJsonBody(event);
  const id = String(body.id || "").trim();
  const imageKey = String(body.imageKey || "").trim();
  const uploaderName = normalizeUploaderName(body.uploaderName);
  const answer = String(body.answer || "").trim();
  const submitterIp = getClientIp(event);

  if (!id || !/^[a-z0-9-]{20,80}$/i.test(id)) {
    throw new HttpError(400, "A valid submission id is required.");
  }

  if (!imageKey.startsWith(`pending/images/${id}`)) {
    throw new HttpError(400, "The uploaded image key does not match this submission.");
  }

  if (!answer) {
    throw new HttpError(400, "The answer is required.");
  }

  if (!uploaderName) {
    throw new HttpError(400, "The uploader name is required.");
  }

  const metadata = await getObjectMetadata(imageKey);

  if (!metadata) {
    throw new HttpError(400, "Upload the image before creating the submission.");
  }

  try {
    validateImageType(metadata.contentType);
    validateImageSize(metadata.contentLength);
  } catch (error) {
    await deleteObject(imageKey).catch(() => {});

    if (error instanceof HttpError) {
      const { maxUploadMb } = getStorageConfig();
      throw new HttpError(
        error.statusCode,
        metadata.contentLength > maxUploadMb * 1024 * 1024
          ? `That file was too large. Keep uploads under ${maxUploadMb} MB.`
          : "Only JPEG, PNG, or WebP uploads are supported.",
      );
    }

    throw error;
  }

  const submission = {
    id,
    answer,
    acceptedAnswers: [],
    uploaderName,
    submitterIp,
    uploaderEmail: "",
    notes: "",
    imageKey,
    submittedAt: new Date().toISOString(),
    status: "pending",
  };

  await putJson(pendingMetadataKey(id), submission);

  return json(200, {
    success: true,
    submission,
  });
});

function normalizeUploaderName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}
