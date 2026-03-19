import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const files = [
  "shared/avatar-selection.js",
  "shared/demo-images.js",
  "shared/word-bank.js",
  "scripts/avatar-icon.js",
  "scripts/landing.js",
  "scripts/shared.js",
  "scripts/play.js",
  "scripts/game-over.js",
  "scripts/play-online.js",
  "scripts/review.js",
  "scripts/upload.js",
  "netlify/functions/_lib/http.js",
  "netlify/functions/_lib/admin.js",
  "netlify/functions/_lib/ip.js",
  "netlify/functions/_lib/bans.js",
  "netlify/functions/_lib/censor.js",
  "netlify/functions/_lib/demo-images.js",
  "netlify/functions/_lib/image-catalog.js",
  "netlify/functions/_lib/leaderboard.js",
  "netlify/functions/_lib/online-duel.js",
  "netlify/functions/_lib/online-wins.js",
  "netlify/functions/_lib/rate-limit.js",
  "netlify/functions/_lib/storage.js",
  "netlify/functions/approved-images.js",
  "netlify/functions/word-bank.js",
  "netlify/functions/leaderboard.js",
  "netlify/functions/online-wins.js",
  "netlify/functions/online-duel-create-room.js",
  "netlify/functions/online-duel-join.js",
  "netlify/functions/online-duel-room.js",
  "netlify/functions/online-duel-guess.js",
  "netlify/functions/online-duel-leave.js",
  "netlify/functions/online-duel-start.js",
  "netlify/functions/admin-bans.js",
  "netlify/functions/admin-online-stats.js",
  "netlify/functions/create-upload-url.js",
  "netlify/functions/submit-image.js",
  "netlify/functions/admin-leaderboard.js",
  "netlify/functions/admin-approved-images.js",
  "netlify/functions/admin-submissions.js",
  "netlify/functions/moderate-submission.js",
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(file)], {
    stdio: "inherit",
  });
}

console.log("Syntax checks passed.");
