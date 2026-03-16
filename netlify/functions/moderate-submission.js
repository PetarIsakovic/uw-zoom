import { requireAdmin } from "./_lib/admin.js";
import { HttpError, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import {
  approvedMetadataKey,
  copyObject,
  deleteObject,
  getJson,
  pendingMetadataKey,
  putJson,
  toApprovedImageKey,
} from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["POST"]);
  requireAdmin(event);

  const body = parseJsonBody(event);
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();

  if (!id || !/^[a-z0-9-]{20,80}$/i.test(id)) {
    throw new HttpError(400, "A valid submission id is required.");
  }

  if (!["approve", "reject"].includes(action)) {
    throw new HttpError(400, "Action must be approve or reject.");
  }

  const metadataKey = pendingMetadataKey(id);
  const submission = await getJson(metadataKey);

  if (!submission) {
    throw new HttpError(404, "That pending submission no longer exists.");
  }

  if (action === "approve") {
    const answer = normalizeAnswer(body.answer || submission.answer);
    const acceptedAnswers = normalizeAcceptedAnswers(
      body.acceptedAnswers ?? submission.acceptedAnswers,
      answer,
    );

    if (!answer) {
      throw new HttpError(400, "The main answer is required before approval.");
    }

    const approvedImageKey = toApprovedImageKey(id, submission.imageKey);
    const approvedRecord = {
      ...submission,
      answer,
      acceptedAnswers,
      status: "approved",
      imageKey: approvedImageKey,
      approvedAt: new Date().toISOString(),
    };

    await copyObject(submission.imageKey, approvedImageKey);
    await putJson(approvedMetadataKey(id), approvedRecord);
  }

  await deleteObject(submission.imageKey);
  await deleteObject(metadataKey);

  return json(200, {
    success: true,
    action,
    id,
  });
});

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

  const seen = new Set();
  const normalizedMain = normalizeComparable(mainAnswer);
  const unique = [];

  for (const entry of parsed) {
    const trimmed = String(entry || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
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
