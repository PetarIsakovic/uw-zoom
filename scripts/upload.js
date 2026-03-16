import { requestJson, setStatus } from "/scripts/shared.js";

const uploadForm = document.querySelector("#upload-form");
const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#image-file");
const uploadStatus = document.querySelector("#upload-status");
const previewFrame = document.querySelector("#file-preview");
const previewImage = document.querySelector("#preview-image");
const answerPanel = document.querySelector("#answer-panel");
const uploaderNameInput = document.querySelector("#uploader-name");

let previewUrl = "";

fileInput.addEventListener("change", () => {
  handleSelectedFile(fileInput.files?.[0] || null);
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
  const uploaderName = String(formData.get("uploaderName") || "").trim();
  const answer = String(formData.get("answer") || "").trim();

  if (!uploaderName) {
    setStatus(uploadStatus, "Add your name so the upload leaderboard can credit you.", "warning");
    uploaderNameInput?.focus();
    return;
  }

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
        uploaderName,
        answer,
      },
    });

    uploadForm.reset();
    clearPreview();
    hideAnswerPanel();
    setStatus(uploadStatus, "Uploaded. The image is now waiting for approval.", "success");
  } catch (error) {
    setStatus(uploadStatus, error.message, "error");
  }
});

dropZone?.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dropZone.dataset.dragging = "true";
});

dropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.dataset.dragging = "true";
});

dropZone?.addEventListener("dragleave", (event) => {
  if (event.relatedTarget && dropZone.contains(event.relatedTarget)) {
    return;
  }

  dropZone.dataset.dragging = "false";
});

dropZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.dataset.dragging = "false";

  const file = event.dataTransfer?.files?.[0] || null;

  if (!file) {
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  handleSelectedFile(file);
});

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  previewFrame.hidden = true;
  previewImage.removeAttribute("src");
  if (dropZone) {
    dropZone.dataset.dragging = "false";
  }
}
function handleSelectedFile(file) {
  if (!file) {
    clearPreview();
    hideAnswerPanel();
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus(uploadStatus, "Only JPEG, PNG, or WebP uploads are supported.", "error");
    fileInput.value = "";
    clearPreview();
    hideAnswerPanel();
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  previewFrame.hidden = false;
  answerPanel.hidden = false;
  setStatus(uploadStatus, "Image selected. Add your name and the answer, then upload it.", "default");
  uploaderNameInput?.focus();
}

function hideAnswerPanel() {
  if (!answerPanel) {
    return;
  }

  answerPanel.hidden = true;
}
