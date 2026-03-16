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
    acceptedAnswers: [],
    uploaderName: "",
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
