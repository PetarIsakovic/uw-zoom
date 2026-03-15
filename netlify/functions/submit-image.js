import { HttpError, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import { objectExists, pendingMetadataKey, putJson } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);

  const body = parseJsonBody(event);
  const id = String(body.id || "").trim();
  const imageKey = String(body.imageKey || "").trim();
  const answer = String(body.answer || "").trim();

  if (!id || !/^[a-z0-9-]{20,80}$/i.test(id)) {
    throw new HttpError(400, "A valid submission id is required.");
  }

  if (!imageKey.startsWith(`pending/images/${id}`)) {
    throw new HttpError(400, "The uploaded image key does not match this submission.");
  }

  if (!answer) {
    throw new HttpError(400, "The answer is required.");
  }

  if (!(await objectExists(imageKey))) {
    throw new HttpError(400, "Upload the image before creating the submission.");
  }

  const submission = {
    id,
    answer,
    acceptedAnswers: uniqueValues(body.alternateAnswers),
    uploaderName: String(body.uploaderName || "").trim(),
    uploaderEmail: String(body.uploaderEmail || "").trim(),
    notes: String(body.notes || "").trim(),
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

function uniqueValues(value) {
  const incoming = Array.isArray(value) ? value : [];
  const seen = new Set();
  const unique = [];

  for (const item of incoming) {
    const trimmed = String(item || "").trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}
