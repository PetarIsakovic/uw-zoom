import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { listJson, storageConfigured } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);

  if (!storageConfigured()) {
    return json(200, {
      leaders: [],
      source: "demo",
    });
  }

  const [approved, pending] = await Promise.all([
    listJson("approved/meta/"),
    listJson("pending/meta/"),
  ]);

  return json(200, {
    leaders: buildUploadLeaders([...approved, ...pending]),
    source: "storage",
  }, {
    "Cache-Control": "public, max-age=60, s-maxage=180, stale-while-revalidate=300",
  });
});

function buildUploadLeaders(entries) {
  const leaders = new Map();

  for (const entry of entries) {
    const displayName = normalizeUploaderName(entry?.uploaderName) || "Anonymous";
    const key = displayName.toLocaleLowerCase("en-CA");
    const current = leaders.get(key) || {
      name: displayName,
      uploads: 0,
    };

    current.uploads += 1;
    leaders.set(key, current);
  }

  return [...leaders.values()].sort(
    (left, right) => right.uploads - left.uploads || left.name.localeCompare(right.name),
  );
}

function normalizeUploaderName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}
