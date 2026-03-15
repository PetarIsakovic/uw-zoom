import { csvToArray, formatDate, requestJson, setStatus } from "/scripts/shared.js";

const uploadForm = document.querySelector("#upload-form");
const fileInput = document.querySelector("#image-file");
const uploadStatus = document.querySelector("#upload-status");
const previewFrame = document.querySelector("#file-preview");
const previewImage = document.querySelector("#preview-image");
const adminKeyInput = document.querySelector("#admin-key");
const loadPendingButton = document.querySelector("#load-pending");
const reviewStatus = document.querySelector("#review-status");
const pendingList = document.querySelector("#pending-list");

let previewUrl = "";
let adminKey = sessionStorage.getItem("uwz-admin-key") || "";

if (adminKey) {
  adminKeyInput.value = adminKey;
}

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files || [];

  if (!file) {
    clearPreview();
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  previewFrame.hidden = false;
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];

  if (!file) {
    setStatus(uploadStatus, "Choose an image file before uploading.", "warning");
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus(uploadStatus, "Only JPEG, PNG, or WebP uploads are supported.", "error");
    return;
  }

  const formData = new FormData(uploadForm);
  const answer = String(formData.get("answer") || "").trim();

  if (!answer) {
    setStatus(uploadStatus, "Add the correct answer for this image.", "warning");
    return;
  }

  try {
    setStatus(uploadStatus, "Preparing a secure AWS upload...", "default");

    const uploadPayload = await requestJson("/api/create-upload-url", {
      method: "POST",
      body: {
        filename: file.name,
        fileType: file.type,
        fileSize: file.size,
      },
    });

    const putResponse = await fetch(uploadPayload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!putResponse.ok) {
      throw new Error("The image upload failed before the submission could be saved.");
    }

    await requestJson("/api/submit-image", {
      method: "POST",
      body: {
        id: uploadPayload.id,
        imageKey: uploadPayload.imageKey,
        answer,
        alternateAnswers: csvToArray(formData.get("alternateAnswers")),
        uploaderName: String(formData.get("uploaderName") || "").trim(),
        uploaderEmail: String(formData.get("uploaderEmail") || "").trim(),
        notes: String(formData.get("notes") || "").trim(),
      },
    });

    uploadForm.reset();
    clearPreview();
    setStatus(uploadStatus, "Uploaded. The image is now waiting for approval.", "success");

    if (adminKey) {
      loadPending();
    }
  } catch (error) {
    setStatus(uploadStatus, error.message, "error");
  }
});

loadPendingButton.addEventListener("click", async () => {
  adminKey = adminKeyInput.value.trim();

  if (!adminKey) {
    setStatus(reviewStatus, "Enter your admin key to unlock review.", "warning");
    return;
  }

  sessionStorage.setItem("uwz-admin-key", adminKey);
  await loadPending();
});

pendingList.addEventListener("click", async (event) => {
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

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  previewFrame.hidden = true;
  previewImage.removeAttribute("src");
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
