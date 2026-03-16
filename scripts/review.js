import { formatDate, requestJson, setStatus } from "/scripts/shared.js";

const adminKeyInput = document.querySelector("#admin-key");
const loadPendingButton = document.querySelector("#load-pending");
const reviewStatus = document.querySelector("#review-status");
const pendingList = document.querySelector("#pending-list");
const leaderboardAdminList = document.querySelector("#leaderboard-admin-list");

let adminKey = "";

loadPendingButton?.addEventListener("click", async () => {
  adminKey = adminKeyInput?.value.trim() || "";

  if (!adminKey) {
    setStatus(reviewStatus, "Enter your admin key to unlock review.", "warning");
    return;
  }

  await loadAdminData();
});

pendingList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before moderating submissions.", "warning");
    return;
  }

  const { id, action } = button.dataset;

  try {
    button.disabled = true;
    setStatus(
      reviewStatus,
      action === "approve" ? "Approving submission..." : "Rejecting submission...",
      "default",
    );

    await requestJson("/api/moderate-submission", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        id,
        action,
      },
    });

    setStatus(
      reviewStatus,
      action === "approve" ? "Submission approved." : "Submission rejected.",
      "success",
    );
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

leaderboardAdminList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-entry-id]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before changing the leaderboard.", "warning");
    return;
  }

  const entryId = button.dataset.entryId || "";

  try {
    button.disabled = true;
    setStatus(reviewStatus, "Deleting leaderboard entry...", "default");

    await requestJson("/api/admin-leaderboard", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        id: entryId,
      },
    });

    setStatus(reviewStatus, "Leaderboard entry deleted.", "success");
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

async function loadAdminData() {
  try {
    setStatus(reviewStatus, "Loading admin data...", "default");
    if (pendingList) {
      pendingList.innerHTML = "";
    }
    if (leaderboardAdminList) {
      leaderboardAdminList.innerHTML = "";
    }

    const [pendingPayload, leaderboardPayload] = await Promise.all([
      requestJson("/api/admin-submissions", {
        headers: adminHeaders(),
      }),
      requestJson("/api/admin-leaderboard", {
        headers: adminHeaders(),
      }),
    ]);

    renderPending(pendingPayload.submissions || []);
    renderLeaderboardEntries(leaderboardPayload.entries || []);
    setStatus(reviewStatus, "Review unlocked.", "success");
  } catch (error) {
    renderPending([]);
    renderLeaderboardEntries([]);
    setStatus(reviewStatus, error.message, "error");
  }
}

function renderPending(submissions) {
  if (!pendingList) {
    return;
  }

  pendingList.innerHTML = "";

  if (!submissions.length) {
    renderEmptyState(pendingList, "No pending uploads right now.");
    return;
  }

  for (const submission of submissions) {
    const card = document.createElement("article");
    card.className = "review-card";

    card.innerHTML = `
      <div class="review-thumb">
        <img src="${escapeHtml(submission.previewUrl)}" alt="${escapeHtml(submission.answer)}" />
      </div>
      <div class="review-copy">
        <h3>${escapeHtml(submission.answer)}</h3>
        <p><strong>Accepted answers:</strong> ${escapeHtml(formatAliases(submission.acceptedAnswers))}</p>
        <p><strong>Uploader:</strong> ${escapeHtml(submission.uploaderName || "Anonymous")}</p>
        <p><strong>Email:</strong> ${escapeHtml(submission.uploaderEmail || "Not provided")}</p>
        <p><strong>Submitted:</strong> ${escapeHtml(formatDate(submission.submittedAt))}</p>
        <p><strong>Notes:</strong> ${escapeHtml(submission.notes || "None")}</p>
      </div>
      <div class="review-actions">
        <button class="button button-primary" data-action="approve" data-id="${escapeHtml(submission.id)}" type="button">Approve</button>
        <button class="button button-secondary" data-action="reject" data-id="${escapeHtml(submission.id)}" type="button">Reject</button>
      </div>
    `;

    pendingList.append(card);
  }
}

function renderLeaderboardEntries(entries) {
  if (!leaderboardAdminList) {
    return;
  }

  leaderboardAdminList.innerHTML = "";

  if (!entries.length) {
    renderEmptyState(leaderboardAdminList, "No leaderboard entries yet.");
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "review-card review-card-compact";

    card.innerHTML = `
      <div class="review-copy">
        <h3>${escapeHtml(entry.name || "Anonymous")}</h3>
        <p><strong>Score:</strong> ${escapeHtml(String(entry.score || 0))} in a row</p>
        <p><strong>Time:</strong> ${escapeHtml(formatDuration(entry.durationMs))}</p>
        <p><strong>Played:</strong> ${escapeHtml(formatDate(entry.playedAt))}</p>
        <p><strong>Result:</strong> ${escapeHtml(entry.result === "win" ? "Win" : "Loss")}</p>
      </div>
      <div class="review-actions">
        <button class="button button-secondary" data-entry-id="${escapeHtml(entry.id)}" type="button">Delete entry</button>
      </div>
    `;

    leaderboardAdminList.append(card);
  }
}

function adminHeaders() {
  return {
    "x-admin-key": adminKey,
  };
}

function renderEmptyState(container, message) {
  const empty = document.createElement("p");
  empty.className = "review-empty";
  empty.textContent = message;
  container.append(empty);
}

function formatAliases(values) {
  return values?.length ? values.join(", ") : "Only the main answer";
}

function formatDuration(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return "Not recorded";
  }

  const durationMs = parsed;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
