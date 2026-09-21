import test from "node:test";
import assert from "node:assert/strict";
import { rotateImages } from "../netlify/functions/_lib/image-rotation.js";

const catalog = Array.from({ length: 31 }, (_, id) => ({ id: String(id), imageUrl: `/image-${id}.jpg` }));

test("every cycle includes every image once across 100 rotations", () => {
  let previous = catalog;
  for (let cycle = 1; cycle <= 100; cycle++) {
    const next = rotateImages(previous, `room:${cycle}`);
    assert.equal(next.length, catalog.length);
    assert.deepEqual(new Set(next.map((image) => image.id)), new Set(catalog.map((image) => image.id)));
    const recent = new Set(previous.slice(-16).map((image) => image.id));
    assert.ok(next.slice(0, 15).every((image) => !recent.has(image.id)));
    assert.notEqual(next[0].id, previous.at(-1).id);
    assert.notDeepEqual(next, previous);
    previous = next;
  }
});

test("overlapping boundary polls choose identical orders", () => {
  assert.deepEqual(rotateImages(structuredClone(catalog), "room:2"), rotateImages(structuredClone(catalog), "room:2"));
  assert.notDeepEqual(rotateImages(catalog, "room:2"), rotateImages(catalog, "room:3"));
});

test("empty, single-image and two-image catalogs remain valid", () => {
  assert.deepEqual(rotateImages([], "room:1"), []);
  assert.deepEqual(rotateImages(catalog.slice(0, 1), "room:1"), catalog.slice(0, 1));
  assert.deepEqual(rotateImages(catalog.slice(0, 2), "room:1"), catalog.slice(0, 2));
});

import { restoreImageQueue } from "../scripts/image-queue.js";

test("solo queue survives reloads and covers the whole catalog every cycle", () => {
  let saved = null;
  let previous = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const played = [];
    for (let i = 0; i < catalog.length; i++) {
      const queue = restoreImageQueue(catalog, saved);
      const id = queue.remaining.shift();
      queue.seen.push(id);
      played.push(id);
      saved = JSON.parse(JSON.stringify(queue)); // retry/refresh persistence
    }
    assert.equal(new Set(played).size, catalog.length);
    if (previous.length) {
      const recent = new Set(previous.slice(-16));
      assert.ok(played.slice(0, 15).every((id) => !recent.has(id)));
    }
    previous = played;
  }
});

test("solo queue includes newly added images and removes deleted images", () => {
  const queue = restoreImageQueue(catalog.slice(1, 4), { seen: ["0", "1"], remaining: ["2"] });
  assert.deepEqual(queue.seen, ["1"]);
  assert.deepEqual(queue.remaining, ["2", "3"]);
});

test("solo queue tolerates malformed saved data and tiny catalogs", () => {
  assert.equal(restoreImageQueue(catalog, { seen: "bad", remaining: {} }).remaining.length, catalog.length);
  assert.deepEqual(restoreImageQueue([], null), { seen: [], remaining: [] });
  assert.deepEqual(restoreImageQueue(catalog.slice(0, 1), { seen: ["0"], remaining: [] }), { seen: [], remaining: ["0"] });
});

import { readFileSync } from "node:fs";
import vm from "node:vm";

test("room advancement wraps consistently for concurrent polls, including legacy rooms", async () => {
  const source = readFileSync(new URL("../netlify/functions/_lib/online-duel.js", import.meta.url), "utf8");
  const syncSource = source.slice(source.indexOf("async function syncRoom("), source.indexOf("function shouldFinishMatch("));
  const context = vm.createContext({
    normalizeRoom: structuredClone,
    normalizeRoundIndex: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    pruneStaleRoomPlayers: async () => false,
    rotateImages,
    ROOM_STATUS_WAITING: "waiting", ROOM_STATUS_FINISHED: "finished", ROOM_STATUS_LIVE: "live",
    ROUND_INTERMISSION_MS: 1000, ROUND_COUNTDOWN_MS: 3000,
  });
  vm.runInContext(syncSource, context);
  const room = {
    id: "legacy-room", status: "live", players: [{ id: "player" }],
    rounds: catalog, currentRoundIndex: catalog.length - 1,
    currentRoundResolvedAt: new Date(Date.now() - 5000).toISOString(),
  };
  const [first, second] = await Promise.all([context.syncRoom(room), context.syncRoom(room)]);
  assert.deepEqual(first.rounds, second.rounds);
  assert.equal(first.imageCycle, 1);
  assert.equal(first.currentRoundIndex, 0);
  assert.equal(first.currentRoundResolvedAt, "");
  assert.equal(new Set(first.rounds.map((image) => image.id)).size, catalog.length);
  assert.notEqual(first.rounds[0].id, catalog.at(-1).id);
});
