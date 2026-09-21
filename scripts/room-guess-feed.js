export function getVisibleRoomGuesses(room, pendingRoomGuesses = []) {
  // Accept older payloads while browser assets and functions roll out.
  const serverGuesses = Array.isArray(room?.roomGuesses)
    ? room.roomGuesses
    : Array.isArray(room?.currentRound?.roomGuesses)
      ? room.currentRound.roomGuesses
      : Array.isArray(room?.lobbyChatMessages)
        ? room.lobbyChatMessages
        : [];
  const pendingGuesses = pendingRoomGuesses.filter((entry) => {
    return entry.roomId === room?.id && entry.roundIndex === Number(room?.roundIndex || 0);
  });

  if (!pendingGuesses.length) return serverGuesses;

  const merged = [...serverGuesses];
  for (const pending of pendingGuesses) {
    const confirmed = serverGuesses.some(
      (entry) => entry.playerId === pending.playerId && entry.guess === pending.guess,
    );
    if (!confirmed) merged.push(pending);
  }

  merged.sort((left, right) => Date.parse(left.at || 0) - Date.parse(right.at || 0));
  return merged;
}
