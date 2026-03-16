import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const files = [
  "shared/demo-images.js",
  "shared/word-bank.js",
  "scripts/landing.js",
  "scripts/shared.js",
  "scripts/play.js",
  "scripts/game-over.js",
  "scripts/review.js",
  "scripts/upload.js",
  "netlify/functions/_lib/http.js",
  "netlify/functions/_lib/admin.js",
  "netlify/functions/_lib/demo-images.js",
  "netlify/functions/_lib/leaderboard.js",
  "netlify/functions/_lib/storage.js",
  "netlify/functions/approved-images.js",
  "netlify/functions/word-bank.js",
  "netlify/functions/leaderboard.js",
  "netlify/functions/create-upload-url.js",
  "netlify/functions/submit-image.js",
  "netlify/functions/admin-leaderboard.js",
  "netlify/functions/admin-submissions.js",
  "netlify/functions/moderate-submission.js",
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", resolve(file)], {
    stdio: "inherit",
  });
}

console.log("Syntax checks passed.");
