import { WORD_BANK, createWordBankIndex } from "../../shared/word-bank.js";
import { requireNotBanned } from "./_lib/bans.js";
import { handleOptions, ensureMethod, json, withErrorHandling } from "./_lib/http.js";
import { listJson, storageConfigured } from "./_lib/storage.js";

export const handler = withErrorHandling(async (event) => {
  const preflight = handleOptions(event, ["GET", "OPTIONS"]);

  if (preflight) {
    return preflight;
  }

  ensureMethod(event, ["GET"]);
  await requireNotBanned(event, "playing the game");

  const combined = [...WORD_BANK];

  if (storageConfigured()) {
    const approved = await listJson("approved/meta/");

    for (const item of approved) {
      if (item?.answer) {
        combined.push(item.answer);
      }

      for (const alias of item?.acceptedAnswers || []) {
        combined.push(alias);
      }
    }
  }

  const unique = [...createWordBankIndex(combined).values()].sort((left, right) =>
    left.localeCompare(right),
  );

  return json(200, {
    words: unique,
  });
});
