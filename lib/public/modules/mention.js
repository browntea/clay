import { mateAvatarUrl } from './avatar.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;

// --- State ---
var mentionActive = false;       // @ autocomplete is visible
var mentionAtIdx = -1;           // position of the @ in input
var mentionFiltered = [];        // filtered mate list
var mentionActiveIdx = -1;       // highlighted item in dropdown
var selectedMateId = null;       // selected mate for pending send
var selectedMateName = null;     // display name of selected mate

// Streaming state
var currentMentionEl = null;     // current mention response DOM element
var mentionFullText = "";        // accumulated response text
var mentionStreamBuffer = "";    // stream smoothing buffer
var mentionDrainTimer = null;
var activeMentionMeta = null;    // { mateId, mateName, avatarColor, avatarStyle, avatarSeed } for reconnect

// --- Init ---
export function initMention(_ctx) {
  ctx = _ctx;
}

// --- @ detection ---
// Called from input.js on each input event.
// Returns { active, query, startIdx } if @ mention is being typed.
export function checkForMention(value, cursorPos) {
  // Look backwards from cursor to find an unmatched @
  var i = cursorPos - 1;
  while (i >= 0) {
    var ch = value.charAt(i);
    if (ch === "@") {
      // @ must be at start of input or preceded by whitespace
      if (i === 0 || /\s/.test(value.charAt(i - 1))) {
        var query = value.substring(i + 1, cursorPos);
        // Don't activate if query contains whitespace (user moved past mention)
        if (/\s/.test(query)) break;
        return { active: true, query: query, startIdx: i };
      }
      break;
    }
    if (/\s/.test(ch)) break; // whitespace before finding @ means no mention
    i--;
  }
  return { active: false, query: "", startIdx: -1 };
}

// --- Autocomplete dropdown ---
export function showMentionMenu(query) {
  var mates = ctx.matesList ? ctx.matesList() : [];
  if (!mates || mates.length === 0) {
    hideMentionMenu();
    return;
  }

  var lowerQuery = query.toLowerCase();
  mentionFiltered = mates.filter(function (m) {
    if (m.status === "interviewing") return false;
    var name = ((m.profile && m.profile.displayName) || m.name || "").toLowerCase();
    return name.indexOf(lowerQuery) !== -1;
  });

  if (mentionFiltered.length === 0) {
    hideMentionMenu();
    return;
  }

  mentionActive = true;
  mentionActiveIdx = 0;

  var menuEl = document.getElementById("mention-menu");
  if (!menuEl) return;

  menuEl.innerHTML = mentionFiltered.map(function (m, i) {
    var name = (m.profile && m.profile.displayName) || m.name || "Mate";
    var color = (m.profile && m.profile.avatarColor) || "#6c5ce7";
    var avatarSrc = mateAvatarUrl(m, 24);
    return '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
      '<img class="mention-item-avatar" src="' + escapeHtml(avatarSrc) + '" width="24" height="24" />' +
      '<span class="mention-item-name">' + escapeHtml(name) + '</span>' +
      '<span class="mention-item-dot" style="background:' + escapeHtml(color) + '"></span>' +
      '</div>';
  }).join("");
  menuEl.classList.add("visible");

  menuEl.querySelectorAll(".mention-item").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      selectMentionItem(parseInt(el.dataset.idx));
    });
  });
}

export function hideMentionMenu() {
  mentionActive = false;
  mentionActiveIdx = -1;
  mentionFiltered = [];
  var menuEl = document.getElementById("mention-menu");
  if (menuEl) {
    menuEl.classList.remove("visible");
    menuEl.innerHTML = "";
  }
}

export function isMentionMenuVisible() {
  return mentionActive && mentionFiltered.length > 0;
}

export function mentionMenuKeydown(e) {
  if (!mentionActive || mentionFiltered.length === 0) return false;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionActiveIdx = (mentionActiveIdx + 1) % mentionFiltered.length;
    updateMentionHighlight();
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionActiveIdx = (mentionActiveIdx - 1 + mentionFiltered.length) % mentionFiltered.length;
    updateMentionHighlight();
    return true;
  }
  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
    e.preventDefault();
    selectMentionItem(mentionActiveIdx);
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    hideMentionMenu();
    return true;
  }
  return false;
}

function selectMentionItem(idx) {
  if (idx < 0 || idx >= mentionFiltered.length) return;
  var mate = mentionFiltered[idx];
  var name = (mate.profile && mate.profile.displayName) || mate.name || "Mate";

  selectedMateId = mate.id;
  selectedMateName = name;

  // Replace @query with @Name in the input
  if (ctx.inputEl && mentionAtIdx >= 0) {
    var val = ctx.inputEl.value;
    var cursorPos = ctx.inputEl.selectionStart;
    // Find the @query portion to replace
    var before = val.substring(0, mentionAtIdx);
    var after = val.substring(cursorPos);
    ctx.inputEl.value = before + "@" + name + " " + after;
    var newCursor = mentionAtIdx + 1 + name.length + 1;
    ctx.inputEl.selectionStart = ctx.inputEl.selectionEnd = newCursor;
    ctx.inputEl.focus();
  }

  hideMentionMenu();
}

function updateMentionHighlight() {
  var menuEl = document.getElementById("mention-menu");
  if (!menuEl) return;
  menuEl.querySelectorAll(".mention-item").forEach(function (el, i) {
    el.classList.toggle("active", i === mentionActiveIdx);
  });
  var activeEl = menuEl.querySelector(".mention-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

// Store the @ position when check detects mention
export function setMentionAtIdx(idx) {
  mentionAtIdx = idx;
}

// --- Mention send ---
// Returns { mateId, mateName, text } if input has an @mention, or null
export function parseMentionFromInput(text) {
  if (!selectedMateId || !selectedMateName) return null;
  var prefix = "@" + selectedMateName + " ";
  // Check if the text starts with or contains the mention prefix
  var mentionIdx = text.indexOf(prefix);
  if (mentionIdx === -1) {
    // Mention was removed from text, clear state
    selectedMateId = null;
    selectedMateName = null;
    return null;
  }
  var mentionText = text.substring(0, mentionIdx) + text.substring(mentionIdx + prefix.length);
  mentionText = mentionText.trim();
  if (!mentionText) mentionText = text.substring(mentionIdx + prefix.length).trim();
  return { mateId: selectedMateId, mateName: selectedMateName, text: mentionText || text };
}

export function clearMentionState() {
  selectedMateId = null;
  selectedMateName = null;
  mentionAtIdx = -1;
}

export function sendMention(mateId, text) {
  if (!ctx.ws || !ctx.connected) return;
  ctx.ws.send(JSON.stringify({ type: "mention", mateId: mateId, text: text }));
}

// --- Mention response rendering ---

// Recreate the mention block if it was lost (e.g. session switch)
function ensureMentionBlock() {
  if (currentMentionEl && currentMentionEl.parentNode) return; // still in DOM
  if (!activeMentionMeta) return;
  // Recreate from saved meta
  handleMentionStart(activeMentionMeta);
  // Re-render any accumulated text
  if (mentionFullText) {
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(mentionFullText);
      highlightCodeBlocks(contentEl);
    }
    // Hide activity bar since we have text
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
  }
}

export function handleMentionStart(msg) {
  // Save meta for potential reconnect after session switch
  activeMentionMeta = {
    mateId: msg.mateId,
    mateName: msg.mateName,
    avatarColor: msg.avatarColor,
    avatarStyle: msg.avatarStyle,
    avatarSeed: msg.avatarSeed,
  };

  // Create the mention response container
  currentMentionEl = document.createElement("div");
  currentMentionEl.className = "msg-mention";
  currentMentionEl.style.setProperty("--mention-color", msg.avatarColor || "#6c5ce7");

  // Header with avatar and name
  var header = document.createElement("div");
  header.className = "mention-header";

  var avatar = document.createElement("img");
  avatar.className = "mention-avatar";
  var avatarSrc = "https://api.dicebear.com/7.x/" + (msg.avatarStyle || "bottts") + "/svg?seed=" + encodeURIComponent(msg.avatarSeed || msg.mateId);
  avatar.src = avatarSrc;
  avatar.width = 20;
  avatar.height = 20;
  header.appendChild(avatar);

  var nameSpan = document.createElement("span");
  nameSpan.className = "mention-name";
  nameSpan.textContent = msg.mateName || "Mate";
  header.appendChild(nameSpan);

  currentMentionEl.appendChild(header);

  // Activity indicator (same pattern as main app)
  var activityDiv = document.createElement("div");
  activityDiv.className = "activity-inline mention-activity-bar";
  activityDiv.innerHTML =
    '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
    '<span class="activity-text">Thinking...</span>';
  currentMentionEl.appendChild(activityDiv);

  // Content area for streamed markdown
  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content mention-content";
  contentDiv.dir = "auto";
  currentMentionEl.appendChild(contentDiv);

  mentionFullText = "";
  mentionStreamBuffer = "";

  if (ctx.messagesEl) {
    ctx.messagesEl.appendChild(currentMentionEl);
    refreshIcons();
    if (ctx.scrollToBottom) ctx.scrollToBottom();
  }
}

export function handleMentionActivity(msg) {
  ensureMentionBlock();
  if (!currentMentionEl) return;
  var bar = currentMentionEl.querySelector(".mention-activity-bar");
  if (msg.activity) {
    // Show or update activity
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "activity-inline mention-activity-bar";
      bar.innerHTML =
        '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
        '<span class="activity-text"></span>';
      var contentEl = currentMentionEl.querySelector(".mention-content");
      if (contentEl) {
        currentMentionEl.insertBefore(bar, contentEl);
      } else {
        currentMentionEl.appendChild(bar);
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

export function handleMentionStream(msg) {
  ensureMentionBlock();
  if (!currentMentionEl) return;

  // Hide activity bar on first text delta
  var bar = currentMentionEl.querySelector(".mention-activity-bar");
  if (bar) bar.style.display = "none";

  mentionStreamBuffer += msg.delta;
  if (!mentionDrainTimer) {
    mentionDrainTimer = requestAnimationFrame(drainMentionStream);
  }
}

function drainMentionStream() {
  mentionDrainTimer = null;
  if (!currentMentionEl || mentionStreamBuffer.length === 0) return;

  var len = mentionStreamBuffer.length;
  var n;
  if (len > 200) n = Math.ceil(len / 4);
  else if (len > 80) n = 8;
  else if (len > 30) n = 5;
  else if (len > 10) n = 2;
  else n = 1;

  var chunk = mentionStreamBuffer.slice(0, n);
  mentionStreamBuffer = mentionStreamBuffer.slice(n);
  mentionFullText += chunk;

  var contentEl = currentMentionEl.querySelector(".mention-content");
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(mentionFullText);
    highlightCodeBlocks(contentEl);
  }

  if (ctx.scrollToBottom) ctx.scrollToBottom();

  if (mentionStreamBuffer.length > 0) {
    mentionDrainTimer = requestAnimationFrame(drainMentionStream);
  }
}

function flushMentionStream() {
  if (mentionDrainTimer) {
    cancelAnimationFrame(mentionDrainTimer);
    mentionDrainTimer = null;
  }
  if (mentionStreamBuffer.length > 0) {
    mentionFullText += mentionStreamBuffer;
    mentionStreamBuffer = "";
  }
  if (currentMentionEl) {
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(mentionFullText);
      highlightCodeBlocks(contentEl);
    }
  }
}

export function handleMentionDone(msg) {
  flushMentionStream();
  // Hide activity bar
  if (currentMentionEl) {
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
    // Add copy handler so user can "click to grab this"
    if (ctx.addCopyHandler && mentionFullText) {
      ctx.addCopyHandler(currentMentionEl, mentionFullText);
    }
  }
  currentMentionEl = null;
  activeMentionMeta = null;
  mentionFullText = "";
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleMentionError(msg) {
  flushMentionStream();
  if (currentMentionEl) {
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = '<div class="mention-error">Error: ' + escapeHtml(msg.error || "Unknown error") + '</div>';
    }
  }
  currentMentionEl = null;
  activeMentionMeta = null;
  mentionFullText = "";
}

// --- History replay: render saved mention entries ---
export function renderMentionUser(entry) {
  // Render user message with @mention indicator
  var div = document.createElement("div");
  div.className = "msg-user";

  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dir = "auto";

  var textEl = document.createElement("span");
  var displayText = "@" + (entry.mateName || "Mate") + " " + (entry.text || "");
  textEl.innerHTML = '<span class="mention-chip">@' + escapeHtml(entry.mateName || "Mate") + '</span> ' + escapeHtml(entry.text || "");
  bubble.appendChild(textEl);
  div.appendChild(bubble);

  if (ctx.messagesEl) ctx.messagesEl.appendChild(div);
}

export function renderMentionResponse(entry) {
  var el = document.createElement("div");
  el.className = "msg-mention";
  el.style.setProperty("--mention-color", entry.avatarColor || "#6c5ce7");

  // Header
  var header = document.createElement("div");
  header.className = "mention-header";

  var avatar = document.createElement("img");
  avatar.className = "mention-avatar";
  var avatarSrc = "https://api.dicebear.com/7.x/" + (entry.avatarStyle || "bottts") + "/svg?seed=" + encodeURIComponent(entry.avatarSeed || entry.mateId);
  avatar.src = avatarSrc;
  avatar.width = 20;
  avatar.height = 20;
  header.appendChild(avatar);

  var nameSpan = document.createElement("span");
  nameSpan.className = "mention-name";
  nameSpan.textContent = entry.mateName || "Mate";
  header.appendChild(nameSpan);

  el.appendChild(header);

  // Content
  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content mention-content";
  contentDiv.dir = "auto";
  contentDiv.innerHTML = renderMarkdown(entry.text || "");
  highlightCodeBlocks(contentDiv);
  el.appendChild(contentDiv);

  if (ctx.messagesEl) ctx.messagesEl.appendChild(el);

  // Add copy handler
  if (ctx.addCopyHandler && entry.text) {
    ctx.addCopyHandler(el, entry.text);
  }
}
