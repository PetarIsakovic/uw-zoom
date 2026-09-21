import { createHash } from "node:crypto";

// A cycle must have the same order in every concurrent request. Sorting by a
// seeded hash avoids independently reshuffling the room at the cycle boundary.
export function rotateImages(previous, seed) {
  const unique = [...new Map(previous.map((image) => [image.id, image])).values()];
  const recent = new Set(unique.slice(-Math.ceil(unique.length / 2)).map((image) => image.id));
  const rank = (image) => createHash("sha256").update(JSON.stringify([seed, image.id])).digest("hex");
  const ranks = new Map(unique.map((image) => [image.id, rank(image)]));
  return unique.sort((left, right) =>
    Number(recent.has(left.id)) - Number(recent.has(right.id)) ||
    ranks.get(left.id).localeCompare(ranks.get(right.id)),
  );
}
