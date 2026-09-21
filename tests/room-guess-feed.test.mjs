import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getVisibleRoomGuesses } from "../scripts/room-guess-feed.js";

// Exercise the real browser renderer with a minimal DOM, including the
// optimistic -> confirmed -> stale poll -> confirmed response sequence.
const source = readFileSync(new URL("../scripts/play-online.js", import.meta.url), "utf8");
const renderer = source.slice(source.indexOf("function renderGuessHistory("), source.indexOf("function renderScoreboard("));
function element() {
  return {
    children: [], dataset: {},
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
  };
}
const context = vm.createContext({
  document: { createElement: element },
  censorProfanity: (value) => value,
  buildEmptyListItem: (text) => ({ textContent: text }),
  // Retain the former constant so this test also reproduces the old filter.
  BOT_CHAT_DELAY_MS: 3500,
});
vm.runInContext(renderer, context);

for (const status of ["waiting", "live"]) {
  test(`${status} chat stays rendered through confirmation and a stale poll`, () => {
    const pending = { roomId: "room", roundIndex: 0, playerId: "you", playerName: "You", guess: "hello", at: new Date(Date.now() + 1000).toISOString(), pending: true };
    const confirmed = { ...pending, pending: false, isChat: true };
    const room = { id: "room", status, roundIndex: 0 };
    for (const [feed, optimistic] of [[[], [pending]], [[confirmed], [pending]], [[], [pending]], [[confirmed], []]]) {
      const container = element();
      context.renderGuessHistory(container, getVisibleRoomGuesses({ ...room, roomGuesses: feed }, optimistic), "Empty");
      assert.equal(container.children.length, 1);
      assert.equal(container.children[0].children[1].textContent, "hello");
    }
  });
}

test("older lobby and game payloads remain compatible", () => {
  const messages = [{ playerId: "other", guess: "hello", isChat: true }];
  assert.deepEqual(getVisibleRoomGuesses({ lobbyChatMessages: messages }), messages);
  assert.deepEqual(getVisibleRoomGuesses({ currentRound: { roomGuesses: messages } }), messages);
  assert.deepEqual(getVisibleRoomGuesses({ roomGuesses: [], lobbyChatMessages: messages }), []);
});

test("optimistic guesses do not leak between rooms or rounds", () => {
  const pending = [{ roomId: "old", roundIndex: 0 }, { roomId: "room", roundIndex: 1 }];
  assert.deepEqual(getVisibleRoomGuesses({ id: "room", roundIndex: 0, roomGuesses: [] }, pending), []);
});
