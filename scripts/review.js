import { formatDate, requestJson, setStatus } from "/scripts/shared.js";

const adminKeyInput = document.querySelector("#admin-key");
const loadPendingButton = document.querySelector("#load-pending");
const reviewStatus = document.querySelector("#review-status");
const onlineStatsList = document.querySelector("#online-stats-list");
const pendingList = document.querySelector("#pending-list");
const leaderboardAdminList = document.querySelector("#leaderboard-admin-list");
const approvedImageList = document.querySelector("#approved-image-list");
const bannedIpList = document.querySelector("#banned-ip-list");

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
  const banButton = event.target.closest("[data-ban-ip]");

  if (banButton) {
    await banIpFromButton(banButton);
    return;
  }

  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before moderating submissions.", "warning");
    return;
  }

  const { id, action } = button.dataset;
  const card = button.closest(".review-card");
  const fields = readEditableFields(card);

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
        ...(action === "approve" ? fields : {}),
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
  const banButton = event.target.closest("[data-ban-ip]");

  if (banButton) {
    await banIpFromButton(banButton);
    return;
  }

  const button = event.target.closest("[data-entry-id]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before changing the leaderboard.", "warning");
    return;
  }

  const entryId = button.dataset.entryId || "";
  const entryType = button.dataset.entryType || "streak";

  try {
    button.disabled = true;
    setStatus(
      reviewStatus,
      entryType === "online-win" ? "Deleting online wins entry..." : "Deleting leaderboard entry...",
      "default",
    );

    await requestJson("/api/admin-leaderboard", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        id: entryId,
        type: entryType,
      },
    });

    setStatus(
      reviewStatus,
      entryType === "online-win" ? "Online wins entry deleted." : "Leaderboard entry deleted.",
      "success",
    );
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

approvedImageList?.addEventListener("click", async (event) => {
  const banButton = event.target.closest("[data-ban-ip]");

  if (banButton) {
    await banIpFromButton(banButton);
    return;
  }

  const button = event.target.closest("[data-approved-action]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before changing approved images.", "warning");
    return;
  }

  const action = button.dataset.approvedAction || "";
  const id = button.dataset.id || "";
  const card = button.closest(".review-card");
  const fields = readEditableFields(card);

  try {
    button.disabled = true;
    setStatus(
      reviewStatus,
      action === "delete" ? "Deleting approved image..." : "Saving approved image...",
      "default",
    );

    await requestJson("/api/admin-approved-images", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        id,
        action,
        ...(action === "update" ? fields : {}),
      },
    });

    setStatus(
      reviewStatus,
      action === "delete" ? "Approved image deleted." : "Approved image updated.",
      "success",
    );
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

bannedIpList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-unban-ip]");

  if (!button) {
    return;
  }

  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before changing bans.", "warning");
    return;
  }

  try {
    button.disabled = true;
    setStatus(reviewStatus, "Removing IP ban...", "default");

    await requestJson("/api/admin-bans", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        action: "unban",
        ip: button.dataset.unbanIp,
      },
    });

    setStatus(reviewStatus, "IP address unbanned.", "success");
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
});

async function loadAdminData() {
  try {
    setStatus(reviewStatus, "Loading admin data...", "default");
    clearList(onlineStatsList);
    clearList(pendingList);
    clearList(leaderboardAdminList);
    clearList(approvedImageList);
    clearList(bannedIpList);

    const [statsPayload, pendingPayload, leaderboardPayload, approvedPayload, bansPayload] = await Promise.all([
      requestJson("/api/admin-online-stats", {
        headers: adminHeaders(),
      }),
      requestJson("/api/admin-submissions", {
        headers: adminHeaders(),
      }),
      requestJson("/api/admin-leaderboard", {
        headers: adminHeaders(),
      }),
      requestJson("/api/admin-approved-images", {
        headers: adminHeaders(),
      }),
      requestJson("/api/admin-bans", {
        headers: adminHeaders(),
      }),
    ]);

    renderOnlineStats(statsPayload);
    renderPending(pendingPayload.submissions || []);
    renderLeaderboardEntries({
      streaks: leaderboardPayload.entries || [],
      onlineWins: leaderboardPayload.onlineWins || [],
    });
    renderApprovedImages(approvedPayload.images || []);
    renderBannedIps(bansPayload.bans || []);
    setStatus(reviewStatus, "Review unlocked.", "success");
  } catch (error) {
    renderOnlineStats(null);
    renderPending([]);
    renderLeaderboardEntries({ streaks: [], onlineWins: [] });
    renderApprovedImages([]);
    renderBannedIps([]);
    setStatus(reviewStatus, error.message, "error");
  }
}

function renderOnlineStats(payload) {
  if (!onlineStatsList) {
    return;
  }

  onlineStatsList.innerHTML = "";

  if (!payload || !payload.totals) {
    renderEmptyState(onlineStatsList, "Online game stats are unavailable right now.");
    return;
  }

  const summaryGrid = document.createElement("div");
  summaryGrid.className = "review-stats-grid";

  const summaryItems = [
    ["Total games played", String(payload.totals.totalGamesPlayed || 0)],
    ["Active games", String(payload.totals.activeGames || 0)],
    ["Queued players", String(payload.totals.queuedPlayers || 0)],
    ["Waiting in lobbies", String(payload.totals.waitingLobbyPlayers || 0)],
    ["Players in active games", String(payload.totals.playersInActiveGames || 0)],
    ["Live games", String(payload.totals.liveGames || 0)],
  ];

  for (const [label, value] of summaryItems) {
    const card = document.createElement("article");
    card.className = "review-card review-stat-card";
    card.innerHTML = `
      <p class="review-stat-label">${escapeHtml(label)}</p>
      <strong class="review-stat-value">${escapeHtml(value)}</strong>
    `;
    summaryGrid.append(card);
  }

  onlineStatsList.append(summaryGrid);

  const queueCard = document.createElement("article");
  queueCard.className = "review-card";
  queueCard.innerHTML = `
    <div class="review-section-head">
      <h3>Public queue</h3>
      <p>${escapeHtml(String(payload.queue?.length || 0))} player${payload.queue?.length === 1 ? "" : "s"} waiting to be assigned.</p>
    </div>
  `;

  const queueBody = document.createElement("div");
  queueBody.className = "review-online-queue";

  if (!payload.queue?.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = "Nobody is waiting in the public queue.";
    queueBody.append(empty);
  } else {
    const queueList = document.createElement("div");
    queueList.className = "review-online-player-list";

    for (const player of payload.queue) {
      const item = document.createElement("div");
      item.className = "review-online-player-row";
      item.innerHTML = `
        <strong>${escapeHtml(player.name || "Anonymous")}</strong>
        <span>${escapeHtml(formatDate(player.joinedAt))}</span>
      `;
      queueList.append(item);
    }

    queueBody.append(queueList);
  }

  queueCard.append(queueBody);
  onlineStatsList.append(queueCard);

  if (!payload.rooms?.length) {
    renderEmptyState(onlineStatsList, "No active rooms right now.");
    return;
  }

  const roomsGrid = document.createElement("div");
  roomsGrid.className = "review-room-grid";

  for (const room of payload.rooms) {
    const roomCard = document.createElement("article");
    roomCard.className = "review-card review-card-room";

    const playerRows = (room.players || [])
      .map((player) => {
        const badges = [
          player.isHost ? '<span class="review-inline-badge">Host</span>' : "",
          room.status === "live"
            ? `<span class="review-inline-badge">Score ${escapeHtml(String(player.score || 0))}</span>`
            : "",
        ]
          .filter(Boolean)
          .join("");

        return `
          <div class="review-online-player-row">
            <div class="review-online-player-copy">
              <strong>${escapeHtml(player.name || "Anonymous")}</strong>
              <span>Joined ${escapeHtml(formatDate(player.joinedAt))}</span>
            </div>
            <div class="review-online-player-meta">${badges}</div>
          </div>
        `;
      })
      .join("");

    roomCard.innerHTML = `
      <div class="review-room-head">
        <div class="review-room-copy">
          <h3>${escapeHtml(room.type === "private" ? "Private room" : "Public room")}</h3>
          <p>
            <strong>Status:</strong> ${escapeHtml(room.status)}<br />
            <strong>Players:</strong> ${escapeHtml(String(room.playerCount || 0))}/${escapeHtml(String(room.maxPlayers || 0))}<br />
            <strong>Host:</strong> ${escapeHtml(room.hostName || "Unknown")}<br />
            <strong>Created:</strong> ${escapeHtml(formatDate(room.createdAt))}
          </p>
        </div>
        <div class="review-room-meta">
          <span class="review-inline-badge">Room ${escapeHtml(room.id)}</span>
          ${
            room.status === "waiting"
              ? `<span class="review-inline-badge">Starts ${room.lobbyStartsAt ? escapeHtml(formatDate(room.lobbyStartsAt)) : "when ready"}</span>`
              : `<span class="review-inline-badge">Round ${escapeHtml(String(room.roundIndex || 0))}/${escapeHtml(String(room.roundCount || 0))}</span>`
          }
        </div>
      </div>
      <div class="review-online-player-list">${playerRows}</div>
    `;

    roomsGrid.append(roomCard);
  }

  onlineStatsList.append(roomsGrid);
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
    card.className = "review-card review-card-editor";

    card.innerHTML = `
      <div class="review-thumb">
        <img src="${escapeHtml(submission.previewUrl)}" alt="${escapeHtml(submission.answer)}" />
      </div>
      <div class="review-copy review-copy-editor">
        <div class="field-group">
          <span class="field-label">Main answer</span>
          <input class="text-input review-answer-input" type="text" value="${escapeHtml(submission.answer)}" />
        </div>
        <div class="field-group">
          <span class="field-label">Other accepted answers</span>
          <textarea class="text-area review-aliases-input" rows="3" placeholder="Dana Porter, DP Library, DP">${escapeHtml(formatAliasesForInput(submission.acceptedAnswers))}</textarea>
        </div>
        <p><strong>Uploader:</strong> ${escapeHtml(submission.uploaderName || "Anonymous")}</p>
        <p><strong>Uploader IP:</strong> ${escapeHtml(submission.submitterIp || "Unknown")}</p>
        <p><strong>Email:</strong> ${escapeHtml(submission.uploaderEmail || "Not provided")}</p>
        <p><strong>Submitted:</strong> ${escapeHtml(formatDate(submission.submittedAt))}</p>
        <p><strong>Notes:</strong> ${escapeHtml(submission.notes || "None")}</p>
      </div>
      <div class="review-actions">
        <button class="button button-primary" data-action="approve" data-id="${escapeHtml(submission.id)}" type="button">Approve</button>
        <button class="button button-secondary" data-action="reject" data-id="${escapeHtml(submission.id)}" type="button">Reject</button>
        ${buildBanButtonMarkup(submission.submitterIp, submission.uploaderName || submission.answer, "pending upload")}
      </div>
    `;

    pendingList.append(card);
  }
}

function renderLeaderboardEntries(payload) {
  if (!leaderboardAdminList) {
    return;
  }

  leaderboardAdminList.innerHTML = "";

  const streaks = Array.isArray(payload?.streaks) ? payload.streaks : [];
  const onlineWins = Array.isArray(payload?.onlineWins) ? payload.onlineWins : [];

  if (!streaks.length && !onlineWins.length) {
    renderEmptyState(leaderboardAdminList, "No leaderboard entries yet.");
    return;
  }

  appendLeaderboardGroup({
    container: leaderboardAdminList,
    heading: "Top streaks",
    emptyMessage: "No streak runs yet.",
    entries: streaks,
    renderCard(entry) {
      return `
        <div class="review-copy">
          <h3>${escapeHtml(entry.name || "Anonymous")}</h3>
          <p><strong>Score:</strong> ${escapeHtml(String(entry.score || 0))} in a row</p>
          <p><strong>Time:</strong> ${escapeHtml(formatDuration(entry.durationMs))}</p>
          <p><strong>Played:</strong> ${escapeHtml(formatDate(entry.playedAt))}</p>
          <p><strong>Result:</strong> ${escapeHtml(entry.result === "win" ? "Win" : "Loss")}</p>
          <p><strong>IP:</strong> ${escapeHtml(entry.ip || "Unknown")}</p>
        </div>
        <div class="review-actions">
          <button class="button button-secondary" data-entry-id="${escapeHtml(entry.id)}" data-entry-type="streak" type="button">Delete entry</button>
          ${buildBanButtonMarkup(entry.ip, entry.name, "leaderboard")}
        </div>
      `;
    },
  });

  appendLeaderboardGroup({
    container: leaderboardAdminList,
    heading: "Online wins",
    emptyMessage: "No online wins yet.",
    entries: onlineWins,
    renderCard(entry) {
      return `
        <div class="review-copy">
          <h3>${escapeHtml(entry.name || "Anonymous")}</h3>
          <p><strong>Wins:</strong> ${escapeHtml(String(entry.wins || 0))}</p>
        </div>
        <div class="review-actions">
          <button class="button button-secondary" data-entry-id="${escapeHtml(entry.id)}" data-entry-type="online-win" type="button">Delete entry</button>
        </div>
      `;
    },
  });
}

function appendLeaderboardGroup({ container, heading, emptyMessage, entries, renderCard }) {
  const group = document.createElement("section");
  group.className = "review-subsection";

  const head = document.createElement("div");
  head.className = "review-section-head";
  head.innerHTML = `<h3>${escapeHtml(heading)}</h3>`;
  group.append(head);

  if (!entries.length) {
    renderEmptyState(group, emptyMessage);
    container.append(group);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "review-card review-card-compact";
    card.innerHTML = renderCard(entry);
    group.append(card);
  }

  container.append(group);
}

function renderApprovedImages(images) {
  if (!approvedImageList) {
    return;
  }

  approvedImageList.innerHTML = "";

  if (!images.length) {
    renderEmptyState(approvedImageList, "No approved images yet.");
    return;
  }

  for (const image of images) {
    const card = document.createElement("article");
    card.className = "review-card review-card-editor";

    card.innerHTML = `
      <div class="review-thumb">
        <img src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.answer)}" />
      </div>
      <div class="review-copy review-copy-editor">
        <div class="field-group">
          <span class="field-label">Main answer</span>
          <input class="text-input review-answer-input" type="text" value="${escapeHtml(image.answer)}" />
        </div>
        <div class="field-group">
          <span class="field-label">Other accepted answers</span>
          <textarea class="text-area review-aliases-input" rows="3" placeholder="Dana Porter, DP Library, DP">${escapeHtml(formatAliasesForInput(image.acceptedAnswers))}</textarea>
        </div>
        <p><strong>Source:</strong> ${escapeHtml(image.sourceLabel || image.source || "Approved image")}</p>
        <p><strong>Uploader:</strong> ${escapeHtml(image.uploaderName || "Anonymous")}</p>
        <p><strong>Uploader IP:</strong> ${escapeHtml(image.submitterIp || "Unknown")}</p>
        <p><strong>Approved:</strong> ${escapeHtml(formatDate(image.approvedAt || image.submittedAt))}</p>
        <p><strong>Current aliases:</strong> ${escapeHtml(formatAliases(image.acceptedAnswers))}</p>
      </div>
      <div class="review-actions">
        <button class="button button-primary" data-approved-action="update" data-id="${escapeHtml(image.id)}" type="button">Save changes</button>
        <button class="button button-secondary" data-approved-action="delete" data-id="${escapeHtml(image.id)}" type="button">Delete image</button>
        ${buildBanButtonMarkup(image.submitterIp, image.uploaderName || image.answer, "approved image")}
      </div>
    `;

    approvedImageList.append(card);
  }
}

function renderBannedIps(bans) {
  if (!bannedIpList) {
    return;
  }

  bannedIpList.innerHTML = "";

  if (!bans.length) {
    renderEmptyState(bannedIpList, "No IP bans right now.");
    return;
  }

  for (const entry of bans) {
    const card = document.createElement("article");
    card.className = "review-card review-card-compact";

    card.innerHTML = `
      <div class="review-copy">
        <h3>${escapeHtml(entry.ip)}</h3>
        <p><strong>Reason label:</strong> ${escapeHtml(entry.label || "Not provided")}</p>
        <p><strong>Source:</strong> ${escapeHtml(entry.source || "Manual")}</p>
        <p><strong>Banned:</strong> ${escapeHtml(formatDate(entry.bannedAt))}</p>
      </div>
      <div class="review-actions">
        <button class="button button-primary" data-unban-ip="${escapeHtml(entry.ip)}" type="button">Unban IP</button>
      </div>
    `;

    bannedIpList.append(card);
  }
}

async function banIpFromButton(button) {
  if (!adminKey) {
    setStatus(reviewStatus, "Unlock review before banning IPs.", "warning");
    return;
  }

  const ip = button.dataset.banIp || "";

  try {
    button.disabled = true;
    setStatus(reviewStatus, "Banning IP address...", "default");

    await requestJson("/api/admin-bans", {
      method: "POST",
      headers: adminHeaders(),
      body: {
        action: "ban",
        ip,
        label: button.dataset.label || "",
        source: button.dataset.source || "",
      },
    });

    setStatus(reviewStatus, "IP address banned.", "success");
    await loadAdminData();
  } catch (error) {
    setStatus(reviewStatus, error.message, "error");
    button.disabled = false;
  }
}

function adminHeaders() {
  return {
    "x-admin-key": adminKey,
  };
}

function clearList(container) {
  if (container) {
    container.innerHTML = "";
  }
}

function renderEmptyState(container, message) {
  const empty = document.createElement("p");
  empty.className = "review-empty";
  empty.textContent = message;
  container.append(empty);
}

function buildBanButtonMarkup(ip, label, source) {
  const normalizedIp = String(ip || "").trim();

  if (!normalizedIp || normalizedIp === "Unknown") {
    return "";
  }

  return `<button class="button button-secondary" data-ban-ip="${escapeHtml(normalizedIp)}" data-label="${escapeHtml(label || "")}" data-source="${escapeHtml(source || "")}" type="button">Ban IP</button>`;
}

function formatAliases(values) {
  return values?.length ? values.join(", ") : "Only the main answer";
}

function formatAliasesForInput(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function formatDuration(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return "Not recorded";
  }

  const totalSeconds = Math.floor(parsed / 1000);
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

function readEditableFields(card) {
  const answerInput = card?.querySelector(".review-answer-input");
  const aliasesInput = card?.querySelector(".review-aliases-input");

  return {
    answer: String(answerInput?.value || "")
      .trim()
      .replace(/\s+/g, " "),
    acceptedAnswers: parseAliasesInput(aliasesInput?.value || ""),
  };
}

function parseAliasesInput(value) {
  const seen = new Set();
  const aliases = [];

  for (const rawEntry of String(value || "").split(/[\n,]/)) {
    const trimmed = rawEntry.trim().replace(/\s+/g, " ");
    const comparable = trimmed
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!trimmed || !comparable || seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    aliases.push(trimmed);
  }

  return aliases;
}
