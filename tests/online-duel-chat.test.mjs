import test from "node:test";
import assert from "node:assert/strict";
import { mergeRoomChatMessages } from "../netlify/functions/_lib/online-duel-chat.js";
import { updateJsonAtomic } from "../netlify/functions/_lib/storage.js";

test("lobby chat survives an interleaved stale heartbeat write and chat conflict", async () => {
  const messageA = {
    id: "message-a",
    playerId: "player-a",
    name: "Alpha",
    text: "first message",
    at: "2026-09-20T20:00:00.000Z",
  };
  const messageB = {
    id: "message-b",
    playerId: "player-b",
    name: "Beta",
    text: "second message",
    at: "2026-09-20T20:00:01.000Z",
  };

  // A heartbeat poll takes a stale snapshot of the room before either message.
  let roomObject = { roomChatMessages: [] };
  const staleHeartbeatSnapshot = structuredClone(roomObject);

  // Chat is a separate CAS-protected object. Force the first conditional PUT to
  // conflict with another writer, then verify the retry merges both messages.
  let chatObject = { value: { messages: [] }, etag: "v1" };
  let firstWrite = true;

  const updated = await updateJsonAtomic(
    "room-chat/test-room.json",
    (current) => ({ messages: mergeRoomChatMessages(current?.messages, [messageA]) }),
    {
      readCurrent: async () => structuredClone(chatObject),
      writeConditional: async (next, expectedEtag) => {
        if (firstWrite) {
          firstWrite = false;
          // Simulate player B winning the race after player A's GET.
          chatObject = { value: { messages: [messageB] }, etag: "v2" };
          const conflict = new Error("precondition failed");
          conflict.name = "PreconditionFailed";
          conflict.$metadata = { httpStatusCode: 412 };
          throw conflict;
        }

        assert.equal(expectedEtag, "v2");
        chatObject = { value: structuredClone(next), etag: "v3" };
      },
    },
  );

  assert.deepEqual(updated.messages.map((message) => message.id), ["message-a", "message-b"]);

  // The delayed heartbeat now writes its stale room snapshot. Because chat is
  // stored separately, this can no longer erase either accepted message.
  roomObject = staleHeartbeatSnapshot;
  const hydrated = mergeRoomChatMessages(roomObject.roomChatMessages, chatObject.value.messages);
  assert.deepEqual(hydrated.map((message) => message.id), ["message-a", "message-b"]);
});
