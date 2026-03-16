import { formatDate, requestJson, setStatus } from "/scripts/shared.js";

const adminKeyInput = document.querySelector("#admin-key");
const loadPendingButton = document.querySelector("#load-pending");
const reviewStatus = document.querySelector("#review-status");
const pendingList = document.querySelector("#pending-list");

let adminKey = "";

loadPendingButton?.addEventListener("click", async () => {
  adminKey = adminKeyInput?.value.trim() || "";

  if (!adminKey) {
    setStatus(reviewStatus, "Enter your admin key to unlock review.", "warning");
    return;
  }

  await loadPending();
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
    await loadPending();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

async function loadPending() {
  try {
    setStatus(reviewStatus, "Loading pending submissions...", "default");
    pendingList.innerHTML = "";

    const payload = await requestJson("/api/admin-submissions", {
      headers: adminHeaders(),
    });

    renderPending(payload.submissions || []);

    if (payload.submissions?.length) {
      setStatus(reviewStatus, "Review unlocked.", "success");
    } else {
      setStatus(reviewStatus, "No pending uploads right now.", "default");
    }
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
  }
}

function renderPending(submissions) {
  pendingList.innerHTML = "";

  if (!submissions.length) {
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

function adminHeaders() {
  return {
    "x-admin-key": adminKey,
  };
}

function formatAliases(values) {
  return values?.length ? values.join(", ") : "Only the main answer";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
