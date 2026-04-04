import { mateAvatarUrl } from './avatar.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;

// --- State ---
var debateActive = false;
var debateTopic = "";
var debateRound = 0;
var debatePhase = "idle";  // idle | live | ended

// Current turn streaming state
var currentTurnEl = null;
var currentTurnMateId = null;
var turnFullText = "";
var turnStreamBuffer = "";
var turnDrainTimer = null;

// --- Init ---
export function initDebate(_ctx) {
  ctx = _ctx;
}

export function resetDebateState() {
  debateActive = false;
  debateTopic = "";
  debateRound = 0;
  debatePhase = "idle";
  flushTurnStream();
  currentTurnEl = null;
  currentTurnMateId = null;
}

function buildAvatarUrl(meta) {
  return "https://api.dicebear.com/7.x/" + (meta.avatarStyle || "bottts") + "/svg?seed=" + encodeURIComponent(meta.avatarSeed || meta.mateId || "mate");
}

// --- Float info panel ---
function showDebateInfoFloat(msg) {
  var floatEl = document.getElementById("debate-info-float");
  if (!floatEl) return;

  var html = '<div class="debate-info-float-inner">';
  html += '<span class="debate-info-mod">' + iconHtml("mic") + ' ' + escapeHtml(msg.moderatorName || "Moderator") + '</span>';
  html += '<span class="debate-info-sep">|</span>';
  html += '<span class="debate-info-label">Panel:</span>';

  if (msg.panelists) {
    for (var i = 0; i < msg.panelists.length; i++) {
      var p = msg.panelists[i];
      if (i > 0) html += '<span class="debate-info-comma">,</span>';
      html += '<span class="debate-info-chip">';
      html += '<img class="debate-info-avatar" src="' + buildAvatarUrl(p) + '" width="14" height="14" />';
      html += '<span>' + escapeHtml(p.name || "") + '</span>';
      if (p.role) html += '<span class="debate-info-role">(' + escapeHtml(p.role) + ')</span>';
      html += '</span>';
    }
  }

  html += '</div>';
  floatEl.innerHTML = html;
  floatEl.classList.remove("hidden");
  refreshIcons();
}

function hideDebateInfoFloat() {
  var floatEl = document.getElementById("debate-info-float");
  if (floatEl) {
    floatEl.classList.add("hidden");
    floatEl.innerHTML = "";
  }
}

// --- Handlers ---

export function handleDebateResumed(msg) {
  debateActive = true;
  debatePhase = "live";
  if (msg.topic) debateTopic = msg.topic;
  if (msg.round) debateRound = msg.round;

  // Show float info panel again if we have it
  showDebateInfoFloat(msg);
}

export function handleDebateStarted(msg) {
  debateActive = true;
  debateTopic = msg.topic || "";
  debateRound = 1;
  debatePhase = "live";

  // Show float info panel
  showDebateInfoFloat(msg);

  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateTurn(msg) {
  debateRound = msg.round || debateRound;

  if (!ctx.messagesEl) return;

  var turnEl = document.createElement("div");
  turnEl.className = "debate-turn";

  // Speaker header
  var speakerRow = document.createElement("div");
  speakerRow.className = "debate-speaker";

  var avi = document.createElement("img");
  avi.className = "debate-speaker-avatar";
  avi.src = buildAvatarUrl(msg);
  avi.width = 24;
  avi.height = 24;
  speakerRow.appendChild(avi);

  var nameSpan = document.createElement("span");
  nameSpan.className = "debate-speaker-name";
  nameSpan.textContent = msg.mateName || "Speaker";
  speakerRow.appendChild(nameSpan);

  var roleSpan = document.createElement("span");
  roleSpan.className = "debate-speaker-role";
  roleSpan.textContent = msg.role || "";
  speakerRow.appendChild(roleSpan);

  turnEl.appendChild(speakerRow);

  // Activity indicator
  var activityDiv = document.createElement("div");
  activityDiv.className = "activity-inline debate-activity-bar";
  activityDiv.innerHTML =
    '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
    '<span class="activity-text">Thinking...</span>';
  turnEl.appendChild(activityDiv);

  // Content area
  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content debate-turn-content";
  contentDiv.dir = "auto";
  turnEl.appendChild(contentDiv);

  ctx.messagesEl.appendChild(turnEl);

  // Set as current streaming target
  currentTurnEl = turnEl;
  currentTurnMateId = msg.mateId;
  turnFullText = "";
  turnStreamBuffer = "";

  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateActivity(msg) {
  if (!currentTurnEl || msg.mateId !== currentTurnMateId) return;

  var bar = currentTurnEl.querySelector(".debate-activity-bar");
  if (msg.activity) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "activity-inline debate-activity-bar";
      bar.innerHTML =
        '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
        '<span class="activity-text"></span>';
      var contentEl = currentTurnEl.querySelector(".debate-turn-content");
      if (contentEl) {
        currentTurnEl.insertBefore(bar, contentEl);
      } else {
        currentTurnEl.appendChild(bar);
      }
      refreshIcons();
    }
    var textEl = bar.querySelector(".activity-text");
    if (textEl) {
      textEl.textContent = msg.activity === "thinking" ? "Thinking..." : msg.activity;
    }
    bar.style.display = "";
  } else {
    if (bar) bar.style.display = "none";
  }
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateStream(msg) {
  if (!currentTurnEl || msg.mateId !== currentTurnMateId) return;

  // Hide activity bar on first text
  var bar = currentTurnEl.querySelector(".debate-activity-bar");
  if (bar) bar.style.display = "none";

  turnStreamBuffer += msg.delta;
  if (!turnDrainTimer) {
    turnDrainTimer = requestAnimationFrame(drainTurnStream);
  }
}

function drainTurnStream() {
  turnDrainTimer = null;
  if (!currentTurnEl || turnStreamBuffer.length === 0) return;

  var len = turnStreamBuffer.length;
  var n;
  if (len > 200) n = Math.ceil(len / 4);
  else if (len > 80) n = 8;
  else if (len > 30) n = 5;
  else if (len > 10) n = 2;
  else n = 1;

  var chunk = turnStreamBuffer.slice(0, n);
  turnStreamBuffer = turnStreamBuffer.slice(n);
  turnFullText += chunk;

  var contentEl = currentTurnEl.querySelector(".debate-turn-content");
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(turnFullText);
    highlightCodeBlocks(contentEl);
  }

  if (ctx.scrollToBottom) ctx.scrollToBottom();

  if (turnStreamBuffer.length > 0) {
    turnDrainTimer = requestAnimationFrame(drainTurnStream);
  }
}

function flushTurnStream() {
  if (turnDrainTimer) {
    cancelAnimationFrame(turnDrainTimer);
    turnDrainTimer = null;
  }
  if (turnStreamBuffer.length > 0) {
    turnFullText += turnStreamBuffer;
    turnStreamBuffer = "";
  }
  if (currentTurnEl) {
    var contentEl = currentTurnEl.querySelector(".debate-turn-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(turnFullText);
      highlightCodeBlocks(contentEl);
    }
  }
}

export function handleDebateTurnDone(msg) {
  flushTurnStream();

  if (currentTurnEl) {
    var bar = currentTurnEl.querySelector(".debate-activity-bar");
    if (bar) bar.style.display = "none";
    if (ctx.addCopyHandler && turnFullText) {
      ctx.addCopyHandler(currentTurnEl, turnFullText);
    }
  }

  currentTurnEl = null;
  currentTurnMateId = null;
  turnFullText = "";
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateCommentQueued(msg) {
  if (!ctx.messagesEl) return;

  var commentEl = document.createElement("div");
  commentEl.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("hand") + " You raised your hand:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = msg.text || "";

  commentEl.appendChild(label);
  commentEl.appendChild(textEl);
  ctx.messagesEl.appendChild(commentEl);

  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateCommentInjected(msg) {
  // Comment was delivered to moderator, no extra UI needed
}

export function handleDebateEnded(msg) {
  debateActive = false;
  debatePhase = "ended";

  flushTurnStream();
  currentTurnEl = null;
  currentTurnMateId = null;

  // Hide float info panel
  hideDebateInfoFloat();

  // Ensure debate bottom bar is removed
  var bottomBar = document.getElementById("debate-bottom-bar");
  if (bottomBar) bottomBar.remove();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();

  if (ctx.messagesEl) {
    renderEndedBanner(msg);
  }

  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

function renderEndedBanner(entry) {
  if (!ctx.messagesEl) return;

  // Remove existing ended banner (prevent duplicates)
  var existing = ctx.messagesEl.querySelector(".debate-ended-banner");
  if (existing) existing.remove();

  var endBanner = document.createElement("div");
  endBanner.className = "debate-ended-banner";

  var reasonText = entry.reason === "natural" ? "Debate concluded" :
                   entry.reason === "user_stopped" ? "Debate stopped by user" :
                   "Debate ended due to error";

  var statusRow = document.createElement("div");
  statusRow.className = "debate-ended-status";
  statusRow.innerHTML = iconHtml("check-circle") + " " + escapeHtml(reasonText) + " (" + (entry.rounds || 0) + " rounds)";
  endBanner.appendChild(statusRow);

  // Resume row
  var resumeRow = document.createElement("div");
  resumeRow.className = "debate-ended-resume";

  var resumeInput = document.createElement("textarea");
  resumeInput.className = "debate-ended-resume-input";
  resumeInput.rows = 1;
  resumeInput.placeholder = "Continue with a new direction...";
  resumeRow.appendChild(resumeInput);

  var resumeBtn = document.createElement("button");
  resumeBtn.className = "debate-ended-resume-btn";
  resumeBtn.textContent = "Resume";
  resumeBtn.addEventListener("click", function () {
    var text = resumeInput.value.trim();
    if (ctx.ws && ctx.ws.readyState === 1) {
      ctx.ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
    }
    endBanner.remove();
  });
  resumeRow.appendChild(resumeBtn);

  endBanner.appendChild(resumeRow);

  // Enter in textarea = resume
  resumeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      resumeBtn.click();
    }
  });

  ctx.messagesEl.appendChild(endBanner);
  refreshIcons();
}

export function handleDebateError(msg) {
  if (ctx.messagesEl && debateActive) {
    var errEl = document.createElement("div");
    errEl.className = "debate-error";
    errEl.textContent = "Error: " + (msg.error || "Unknown error");
    ctx.messagesEl.appendChild(errEl);
    if (ctx.scrollToBottom) ctx.scrollToBottom();
  }
}

// --- History replay ---
export function renderDebateStarted(entry) {
  handleDebateStarted(entry);
}

export function renderDebateTurnDone(entry) {
  if (!ctx.messagesEl) return;

  var turnEl = document.createElement("div");
  turnEl.className = "debate-turn";

  var speakerRow = document.createElement("div");
  speakerRow.className = "debate-speaker";

  if (entry.avatarStyle || entry.avatarSeed || entry.mateId) {
    var avi = document.createElement("img");
    avi.className = "debate-speaker-avatar";
    avi.src = buildAvatarUrl(entry);
    avi.width = 24;
    avi.height = 24;
    speakerRow.appendChild(avi);
  }

  var nameSpan = document.createElement("span");
  nameSpan.className = "debate-speaker-name";
  nameSpan.textContent = entry.mateName || "Speaker";
  speakerRow.appendChild(nameSpan);

  var roleSpan = document.createElement("span");
  roleSpan.className = "debate-speaker-role";
  roleSpan.textContent = entry.role || "";
  speakerRow.appendChild(roleSpan);

  turnEl.appendChild(speakerRow);

  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content debate-turn-content";
  contentDiv.dir = "auto";
  contentDiv.innerHTML = renderMarkdown(entry.text || "");
  highlightCodeBlocks(contentDiv);
  turnEl.appendChild(contentDiv);

  ctx.messagesEl.appendChild(turnEl);
}

export function renderDebateUserResume(entry) {
  if (!ctx.messagesEl) return;

  // Remove the ended banner since we're resuming
  var endedBanner = ctx.messagesEl.querySelector(".debate-ended-banner");
  if (endedBanner) endedBanner.remove();

  // Also remove conclude confirm if present
  var confirmEl = document.getElementById("debate-conclude-confirm");
  if (confirmEl) confirmEl.remove();

  var el = document.createElement("div");
  el.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("play") + " Debate resumed:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = entry.text || "";

  el.appendChild(label);
  el.appendChild(textEl);
  ctx.messagesEl.appendChild(el);
  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function renderDebateEnded(entry) {
  if (!ctx.messagesEl) return;

  debateActive = false;
  debatePhase = "ended";
  hideDebateInfoFloat();

  // Ensure debate bars are removed during history replay
  var bottomBar = document.getElementById("debate-bottom-bar");
  if (bottomBar) bottomBar.remove();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();

  renderEndedBanner(entry);
}

export function renderDebateCommentInjected(entry) {
  if (!ctx.messagesEl) return;

  var commentEl = document.createElement("div");
  commentEl.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("hand") + " User comment:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = entry.text || "";

  commentEl.appendChild(label);
  commentEl.appendChild(textEl);
  ctx.messagesEl.appendChild(commentEl);
  refreshIcons();
}

export function isDebateActive() {
  return debateActive;
}

// --- Debate modal ---
var modalEl = null;
var selectedPanelists = [];

export function openDebateModal() {
  modalEl = document.getElementById("debate-modal");
  if (!modalEl) return;

  modalEl.classList.remove("hidden");

  var topicInput = document.getElementById("debate-topic-input");
  if (topicInput) {
    topicInput.value = "";
    topicInput.focus();
  }

  // Populate panelist list from mates (exclude current mate = moderator)
  var panelList = document.getElementById("debate-panel-list");
  if (panelList) {
    panelList.innerHTML = "";
    selectedPanelists = [];
    var mates = ctx.matesList ? ctx.matesList() : [];
    var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m.status === "interviewing") continue;
      if (m.id === currentMateId) continue; // moderator, skip
      var item = createPanelItem(m);
      panelList.appendChild(item);
    }
  }

  // Close button
  var closeBtn = document.getElementById("debate-modal-close");
  if (closeBtn) {
    closeBtn.onclick = closeDebateModal;
  }
  var cancelBtn = document.getElementById("debate-modal-cancel");
  if (cancelBtn) {
    cancelBtn.onclick = closeDebateModal;
  }

  // Backdrop click to close
  var backdrop = modalEl.querySelector(".debate-modal-backdrop");
  if (backdrop) {
    backdrop.onclick = closeDebateModal;
  }

  // Start button
  var startBtn = document.getElementById("debate-modal-start");
  if (startBtn) {
    startBtn.onclick = function () {
      var topic = topicInput ? topicInput.value.trim() : "";
      if (!topic) {
        topicInput.focus();
        return;
      }
      if (selectedPanelists.length === 0) return;

      var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
      if (!currentMateId) return;

      // Create a new session first, then send debate_start after switch
      if (ctx.ws) {
        var debatePayload = {
          type: "debate_start",
          moderatorId: currentMateId,
          topic: topic,
          panelists: selectedPanelists.map(function (id) {
            return { mateId: id, role: "", brief: "" };
          }),
        };

        // Listen for session_switched once, then send debate_start
        var onMessage = function (evt) {
          try {
            var data = JSON.parse(evt.data);
            if (data.type === "session_switched") {
              ctx.ws.removeEventListener("message", onMessage);
              ctx.ws.send(JSON.stringify(debatePayload));
            }
          } catch (e) {}
        };
        ctx.ws.addEventListener("message", onMessage);
        ctx.ws.send(JSON.stringify({ type: "new_session" }));
      }

      closeDebateModal();
    };
  }

  refreshIcons();
}

function createPanelItem(mate) {
  var item = document.createElement("div");
  item.className = "debate-panel-item";
  item.dataset.mateId = mate.id;

  var cb = document.createElement("input");
  cb.type = "checkbox";
  item.appendChild(cb);

  var avatarSrc = "https://api.dicebear.com/7.x/" +
    ((mate.profile && mate.profile.avatarStyle) || "bottts") +
    "/svg?seed=" + encodeURIComponent((mate.profile && mate.profile.avatarSeed) || mate.id);
  var avi = document.createElement("img");
  avi.className = "debate-panel-item-avatar";
  avi.src = avatarSrc;
  item.appendChild(avi);

  var info = document.createElement("div");
  info.className = "debate-panel-item-info";

  var nameSpan = document.createElement("div");
  nameSpan.className = "debate-panel-item-name";
  nameSpan.textContent = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
  info.appendChild(nameSpan);

  if (mate.bio) {
    var bioSpan = document.createElement("div");
    bioSpan.className = "debate-panel-item-bio";
    bioSpan.textContent = mate.bio;
    info.appendChild(bioSpan);
  }

  item.appendChild(info);

  // Toggle selection
  function toggle() {
    var idx = selectedPanelists.indexOf(mate.id);
    if (idx === -1) {
      selectedPanelists.push(mate.id);
      item.classList.add("selected");
      cb.checked = true;
    } else {
      selectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
      cb.checked = false;
    }
  }

  item.addEventListener("click", function (e) {
    if (e.target === cb) return; // let checkbox handle itself
    toggle();
  });
  cb.addEventListener("change", function () {
    var idx = selectedPanelists.indexOf(mate.id);
    if (cb.checked && idx === -1) {
      selectedPanelists.push(mate.id);
      item.classList.add("selected");
    } else if (!cb.checked && idx !== -1) {
      selectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
    }
  });

  return item;
}

export function closeDebateModal() {
  if (modalEl) {
    modalEl.classList.add("hidden");
  }
  selectedPanelists = [];
}

// --- Quick Debate: start debate from DM context ---
var quickDebateEl = null;
var quickSelectedPanelists = [];

export function openQuickDebateModal(dmMessages) {
  closeQuickDebateModal();

  // Build DM context from recent messages (last 20, capped)
  var dmContext = "";
  if (dmMessages && dmMessages.length) {
    var recent = dmMessages.slice(-20);
    var parts = [];
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      var speaker = m.isMate ? "Mate" : "User";
      var text = m.text || "";
      if (text.length > 500) text = text.substring(0, 500) + "...";
      parts.push(speaker + ": " + text);
    }
    dmContext = parts.join("\n");
  }

  quickSelectedPanelists = [];

  // Create modal overlay
  quickDebateEl = document.createElement("div");
  quickDebateEl.className = "debate-modal-overlay";

  var html = '';
  html += '<div class="debate-modal-backdrop"></div>';
  html += '<div class="debate-modal-content quick-debate-modal">';
  html += '<div class="debate-modal-header">';
  html += '<h3>Quick Debate</h3>';
  html += '<button class="debate-modal-close-btn">&times;</button>';
  html += '</div>';

  // Optional topic override
  html += '<div class="debate-modal-field">';
  html += '<label>Topic <span style="color:var(--text-tertiary);font-weight:normal">(optional, auto-detected from conversation)</span></label>';
  html += '<input type="text" class="quick-debate-topic" placeholder="Leave blank to auto-detect..." maxlength="200" spellcheck="false">';
  html += '</div>';

  // Panelist selection
  html += '<div class="debate-modal-field">';
  html += '<label>Select Panelists</label>';
  html += '<div class="quick-debate-panel-list"></div>';
  html += '</div>';

  html += '<div class="debate-modal-actions">';
  html += '<button class="debate-modal-cancel-btn">Cancel</button>';
  html += '<button class="debate-modal-start-btn">Start Debate</button>';
  html += '</div>';

  html += '</div>';
  quickDebateEl.innerHTML = html;
  document.body.appendChild(quickDebateEl);

  // Populate panelist list
  var panelList = quickDebateEl.querySelector(".quick-debate-panel-list");
  var mates = ctx.matesList ? ctx.matesList() : [];
  var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
  for (var j = 0; j < mates.length; j++) {
    var mate = mates[j];
    if (mate.status === "interviewing") continue;
    if (mate.id === currentMateId) continue;
    var item = createQuickPanelItem(mate);
    panelList.appendChild(item);
  }

  // Events
  quickDebateEl.querySelector(".debate-modal-backdrop").onclick = closeQuickDebateModal;
  quickDebateEl.querySelector(".debate-modal-close-btn").onclick = closeQuickDebateModal;
  quickDebateEl.querySelector(".debate-modal-cancel-btn").onclick = closeQuickDebateModal;

  quickDebateEl.querySelector(".debate-modal-start-btn").onclick = function () {
    if (quickSelectedPanelists.length === 0) return;
    if (!currentMateId) return;

    var topicInput = quickDebateEl.querySelector(".quick-debate-topic");
    var topic = topicInput ? topicInput.value.trim() : "";

    var debatePayload = {
      type: "debate_start",
      quickStart: true,
      moderatorId: currentMateId,
      topic: topic || "(auto-detect from conversation)",
      dmContext: dmContext,
      panelists: quickSelectedPanelists.map(function (id) {
        return { mateId: id, role: "", brief: "" };
      }),
    };

    // Create new session, then send debate_start
    if (ctx.ws) {
      var onMessage = function (evt) {
        try {
          var data = JSON.parse(evt.data);
          if (data.type === "session_switched") {
            ctx.ws.removeEventListener("message", onMessage);
            ctx.ws.send(JSON.stringify(debatePayload));
          }
        } catch (e) {}
      };
      ctx.ws.addEventListener("message", onMessage);
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }

    closeQuickDebateModal();
  };

  // Focus topic input
  var topicEl = quickDebateEl.querySelector(".quick-debate-topic");
  if (topicEl) setTimeout(function () { topicEl.focus(); }, 50);

  refreshIcons();
}

function createQuickPanelItem(mate) {
  var item = document.createElement("div");
  item.className = "debate-panel-item";
  item.dataset.mateId = mate.id;

  var cb = document.createElement("input");
  cb.type = "checkbox";
  item.appendChild(cb);

  var avatarSrc = mateAvatarUrl(mate, 32);
  var avi = document.createElement("img");
  avi.className = "debate-panel-item-avatar";
  avi.src = avatarSrc;
  item.appendChild(avi);

  var info = document.createElement("div");
  info.className = "debate-panel-item-info";
  var nameSpan = document.createElement("div");
  nameSpan.className = "debate-panel-item-name";
  nameSpan.textContent = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
  info.appendChild(nameSpan);
  if (mate.bio) {
    var bioSpan = document.createElement("div");
    bioSpan.className = "debate-panel-item-bio";
    bioSpan.textContent = mate.bio;
    info.appendChild(bioSpan);
  }
  item.appendChild(info);

  function toggle() {
    var idx = quickSelectedPanelists.indexOf(mate.id);
    if (idx === -1) {
      quickSelectedPanelists.push(mate.id);
      item.classList.add("selected");
      cb.checked = true;
    } else {
      quickSelectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
      cb.checked = false;
    }
  }

  item.addEventListener("click", function (e) {
    if (e.target === cb) return;
    toggle();
  });
  cb.addEventListener("change", function () {
    var idx = quickSelectedPanelists.indexOf(mate.id);
    if (cb.checked && idx === -1) { quickSelectedPanelists.push(mate.id); item.classList.add("selected"); }
    else if (!cb.checked && idx !== -1) { quickSelectedPanelists.splice(idx, 1); item.classList.remove("selected"); }
  });

  return item;
}

export function closeQuickDebateModal() {
  if (quickDebateEl) {
    quickDebateEl.remove();
    quickDebateEl = null;
  }
  quickSelectedPanelists = [];
}

// --- Debate Brief Card (inline proposal from DM) ---

export function handleDebateBriefReady(msg) {
  renderDebateBriefCard(msg, false);
}

export function renderDebateBriefReady(msg) {
  renderDebateBriefCard(msg, true);
}

function renderDebateBriefCard(msg, resolved) {
  var el = document.createElement("div");
  el.className = "debate-brief-card" + (resolved ? " resolved" : "");

  // Header
  var header = document.createElement("div");
  header.className = "debate-brief-card-header";
  header.innerHTML =
    '<span class="debate-brief-card-icon">' + iconHtml("message-circle") + '</span>' +
    '<span class="debate-brief-card-title">Debate Proposal</span>' +
    '<span class="debate-brief-card-chevron">' + iconHtml("chevron-down") + '</span>';

  // Body
  var body = document.createElement("div");
  body.className = "debate-brief-card-body";

  var topicHtml = '<div class="debate-brief-topic">' + escapeHtml(msg.topic || "Untitled") + '</div>';

  if (msg.context) {
    topicHtml += '<div class="debate-brief-context">' + escapeHtml(msg.context) + '</div>';
  }

  topicHtml += '<div class="debate-brief-moderator">' +
    iconHtml("mic") + ' <strong>Moderator:</strong> ' + escapeHtml(msg.moderatorName || "Unknown") +
    '</div>';

  topicHtml += '<div class="debate-brief-panelists-label">' + iconHtml("users") + ' <strong>Panelists:</strong></div>';
  topicHtml += '<div class="debate-brief-panelists">';
  if (msg.panelists) {
    for (var i = 0; i < msg.panelists.length; i++) {
      var p = msg.panelists[i];
      topicHtml += '<div class="debate-brief-panelist">';
      topicHtml += '<span class="debate-brief-panelist-name">' + escapeHtml(p.name || "Unknown") + '</span>';
      if (p.role) {
        topicHtml += '<span class="debate-brief-panelist-role">' + escapeHtml(p.role) + '</span>';
      }
      topicHtml += '</div>';
    }
  }
  topicHtml += '</div>';

  if (msg.specialRequests) {
    topicHtml += '<div class="debate-brief-special">' +
      iconHtml("info") + ' ' + escapeHtml(msg.specialRequests) +
      '</div>';
  }

  body.innerHTML = topicHtml;

  // Actions
  var actions = document.createElement("div");
  actions.className = "debate-brief-actions";

  if (resolved) {
    actions.innerHTML = '<span class="debate-brief-resolved-label">' + iconHtml("check") + ' Debate started</span>';
  } else {
    var startBtn = document.createElement("button");
    startBtn.className = "debate-brief-start-btn";
    startBtn.innerHTML = iconHtml("play") + " Start Debate";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "debate-brief-cancel-btn";
    cancelBtn.textContent = "Cancel";

    startBtn.addEventListener("click", function () {
      if (ctx.sendWs) {
        ctx.sendWs({ type: "debate_confirm_brief" });
      }
      el.classList.add("resolved");
      actions.innerHTML = '<span class="debate-brief-resolved-label">' + iconHtml("check") + ' Starting debate...</span>';
      refreshIcons();
    });

    cancelBtn.addEventListener("click", function () {
      if (ctx.sendWs) {
        ctx.sendWs({ type: "debate_stop" });
      }
      el.classList.add("resolved");
      actions.innerHTML = '<span class="debate-brief-resolved-label debate-brief-cancelled">' + iconHtml("x") + ' Cancelled</span>';
      refreshIcons();
    });

    actions.appendChild(startBtn);
    actions.appendChild(cancelBtn);
  }

  // Collapse toggle
  header.addEventListener("click", function () {
    el.classList.toggle("collapsed");
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(actions);
  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
}
