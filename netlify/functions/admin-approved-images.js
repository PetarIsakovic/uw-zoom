import { requireAdmin } from "./_lib/admin.js";
import { HttpError, getOrigin, handleOptions, ensureMethod, json, parseJsonBody, withErrorHandling } from "./_lib/http.js";
import {
  deleteDemoCatalogImage,
  isDemoCatalogImage,
  listAdminCatalogImages,
  updateDemoCatalogImage,
} from "./_lib/image-catalog.js";
import {
  approvedMetadataKey,
  deleteObject,
  getJson,
  putJson,
} from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "POST", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET", "POST"]);
  requireAdmin(event);

  if (event.httpMethod === "GET") {
    const origin = getOrigin(event);

    return json(200, {
      images: await listAdminCatalogImages(origin),
    });
  }

  const body = parseJsonBody(event);
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const origin = getOrigin(event);

  if (!id || !/^[a-z0-9-]{4,80}$/i.test(id)) {
    throw new HttpError(400, "A valid approved image id is required.");
  }

  if (!["update", "delete"].includes(action)) {
    throw new HttpError(400, "Action must be update or delete.");
  }

  if (isDemoCatalogImage(id)) {
    if (action === "delete") {
      await deleteDemoCatalogImage(id);

      return json(200, {
        success: true,
        action,
        id,
      });
    }

    return json(200, {
      success: true,
      action,
      image: await updateDemoCatalogImage(origin, id, body),
    });
  }

  const metadataKey = approvedMetadataKey(id);
  const record = await getJson(metadataKey);

  if (!record) {
    throw new HttpError(404, "That approved image no longer exists.");
  }

  if (action === "delete") {
    await deleteObject(record.imageKey);
    await deleteObject(metadataKey);

    return json(200, {
      success: true,
      action,
      id,
    });
  }

  const answer = normalizeAnswer(body.answer);
  const acceptedAnswers = normalizeAcceptedAnswers(body.acceptedAnswers, answer);

  if (!answer) {
    throw new HttpError(400, "The main answer is required.");
  }

  const updatedRecord = {
    ...record,
    answer,
    acceptedAnswers,
    updatedAt: new Date().toISOString(),
  };

  await putJson(metadataKey, updatedRecord);

  return json(200, {
    success: true,
    action,
    image: updatedRecord,
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
