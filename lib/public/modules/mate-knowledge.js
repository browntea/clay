import { iconHtml, refreshIcons } from './icons.js';
import { hideNotes } from './sticky-notes.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';

var getMateWs = null;
var containerEl = null;
var filesEl = null;
var sidebarBtn = null;
var countBadge = null;
var visible = false;
var cachedFiles = [];

// Sidebar panels
var conversationsPanel = null;
var knowledgePanel = null;
var knowledgeBackBtn = null;
var knowledgeAddSidebarBtn = null;

// Editor elements
var activeNameEl = null;
var editorNameEl = null;
var editorContentEl = null;
var editorSaveBtn = null;
var editorDeleteBtn = null;
var editorPreviewEl = null;
var editorHighlightEl = null;
var editorHighlightPre = null;
var previewTimer = null;
var editorExtEl = null;
var nameGroupEl = null;
var editingFile = null;
var dirty = false;

export function initMateKnowledge(mateWsGetter) {
  getMateWs = mateWsGetter;
  containerEl = document.getElementById("mate-knowledge-container");
  filesEl = document.getElementById("mate-knowledge-files");
  sidebarBtn = document.getElementById("mate-knowledge-btn");
  countBadge = document.getElementById("mate-knowledge-count");

  // Sidebar panels
  conversationsPanel = document.getElementById("mate-sidebar-conversations");
  knowledgePanel = document.getElementById("mate-sidebar-knowledge");
  knowledgeBackBtn = document.getElementById("mate-knowledge-back-btn");
  knowledgeAddSidebarBtn = document.getElementById("mate-knowledge-add-sidebar-btn");

  // Editor
  activeNameEl = document.getElementById("mate-knowledge-active-name");
  editorNameEl = document.getElementById("mate-knowledge-editor-name");
  editorContentEl = document.getElementById("mate-knowledge-editor-content");
  editorSaveBtn = document.getElementById("mate-knowledge-editor-save");
  editorDeleteBtn = document.getElementById("mate-knowledge-editor-delete");
  editorPreviewEl = document.getElementById("mate-knowledge-editor-preview");
  editorHighlightEl = document.getElementById("mate-knowledge-editor-highlight");
  editorHighlightPre = editorHighlightEl ? editorHighlightEl.parentElement : null;
  editorExtEl = document.getElementById("mate-knowledge-editor-ext");
  nameGroupEl = document.getElementById("mate-knowledge-name-group");

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (visible) { hideKnowledge(); } else { showKnowledge(); }
    });
  }

  if (knowledgeBackBtn) {
    knowledgeBackBtn.addEventListener("click", hideKnowledge);
  }

  var closeBtn = document.getElementById("mate-knowledge-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      // Close editor, keep sidebar file list open
      if (containerEl) containerEl.classList.add("hidden");
      editingFile = null;
      renderFileList();
    });
  }

  if (knowledgeAddSidebarBtn) {
    knowledgeAddSidebarBtn.addEventListener("click", function () {
      selectFile(null, "");
    });
  }

  if (editorSaveBtn) editorSaveBtn.addEventListener("click", saveKnowledge);

  if (editorDeleteBtn) {
    editorDeleteBtn.addEventListener("click", function () {
      if (editingFile) {
        var ws = getMateWs ? getMateWs() : null;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "knowledge_delete", name: editingFile }));
        }
        selectFile(null, "");
      }
    });
  }

  // Stop keyboard events from leaking
  var stopProp = function (e) {
    e.stopPropagation();
  };
  var editorKeydown = function (e) {
    e.stopPropagation();
    // Keep Cmd+Z / Cmd+Shift+Z inside the textarea only
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.stopImmediatePropagation();
    }
  };
  if (editorNameEl) {
    editorNameEl.addEventListener("keydown", stopProp);
    editorNameEl.addEventListener("keyup", stopProp);
    editorNameEl.addEventListener("keypress", stopProp);
  }
  if (editorContentEl) {
    editorContentEl.addEventListener("keydown", editorKeydown);
    editorContentEl.addEventListener("keyup", stopProp);
    editorContentEl.addEventListener("keypress", stopProp);
    editorContentEl.addEventListener("input", function () {
      dirty = true;
      if (editorSaveBtn) editorSaveBtn.disabled = false;
      updateHighlight();
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 150);
    });
    editorContentEl.addEventListener("scroll", syncHighlightScroll);
    initFormatPopover(editorContentEl);
  }
}

export function showKnowledge() {
  visible = true;
  hideNotes();

  // Toggle sidebar panels: hide conversations, show knowledge file list
  if (conversationsPanel) conversationsPanel.classList.add("hidden");
  if (knowledgePanel) knowledgePanel.classList.remove("hidden");
  if (sidebarBtn) sidebarBtn.classList.add("active");

  // Don't show editor yet, only when a file is selected
  requestKnowledgeList();
}

export function hideKnowledge() {
  visible = false;

  // Toggle sidebar panels: show conversations, hide knowledge file list
  if (conversationsPanel) conversationsPanel.classList.remove("hidden");
  if (knowledgePanel) knowledgePanel.classList.add("hidden");
  if (sidebarBtn) sidebarBtn.classList.remove("active");

  // Hide editor/preview and reset state
  if (containerEl) containerEl.classList.add("hidden");
  editingFile = null;
  cachedFiles = [];

  // Reset badge
  if (countBadge) {
    countBadge.textContent = "";
    countBadge.classList.add("hidden");
  }
}

export function isKnowledgeVisible() {
  return visible;
}

export function requestKnowledgeList() {
  var ws = getMateWs ? getMateWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_list" }));
  }
}

export function renderKnowledgeList(files) {
  cachedFiles = files || [];

  // Update badge
  if (countBadge) {
    if (cachedFiles.length > 0) {
      countBadge.textContent = String(cachedFiles.length);
      countBadge.classList.remove("hidden");
    } else {
      countBadge.classList.add("hidden");
    }
  }

  renderFileList();
}

function renderFileList() {
  if (!filesEl) return;
  filesEl.innerHTML = "";

  if (cachedFiles.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mate-knowledge-empty";
    empty.textContent = "No knowledge files yet";
    filesEl.appendChild(empty);
  }

  for (var i = 0; i < cachedFiles.length; i++) {
    filesEl.appendChild(renderFileItem(cachedFiles[i]));
  }
  refreshIcons();
}

function renderFileItem(file) {
  var item = document.createElement("div");
  item.className = "mate-knowledge-file-item";
  if (editingFile === file.name) item.classList.add("active");

  var icon = document.createElement("span");
  icon.className = "mate-knowledge-file-icon";
  icon.innerHTML = iconHtml(file.name.endsWith(".jsonl") ? "database" : "file-text");
  item.appendChild(icon);

  var name = document.createElement("span");
  name.className = "mate-knowledge-file-name";
  var isJsonl = file.name.endsWith(".jsonl");
  name.textContent = file.name.replace(/\.(md|jsonl)$/, "");
  item.appendChild(name);

  if (isJsonl) {
    var badge = document.createElement("span");
    badge.className = "mate-knowledge-file-badge";
    badge.textContent = "data";
    item.appendChild(badge);
  }

  item.addEventListener("click", (function (fname) {
    return function () {
      var ws = getMateWs ? getMateWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "knowledge_read", name: fname }));
      }
    };
  })(file.name));

  return item;
}

export function handleKnowledgeContent(msg) {
  if (msg.name && msg.name.endsWith(".jsonl")) {
    selectJsonlFile(msg.name, msg.content || "");
  } else {
    selectFile(msg.name, msg.content || "");
  }
}

function selectJsonlFile(fileName, content) {
  editingFile = fileName;
  dirty = false;

  if (containerEl) containerEl.classList.remove("hidden");

  // Show name, hide name input group
  if (activeNameEl) { activeNameEl.textContent = fileName.replace(/\.jsonl$/, ""); activeNameEl.classList.remove("hidden"); }
  if (nameGroupEl) nameGroupEl.classList.add("hidden");

  // Hide editor pane and controls
  if (editorContentEl) editorContentEl.value = "";
  if (editorSaveBtn) editorSaveBtn.style.display = "none";
  if (editorDeleteBtn) editorDeleteBtn.style.display = "";
  if (editorHighlightPre) editorHighlightPre.style.display = "none";
  if (editorContentEl) editorContentEl.style.display = "none";

  // Build table from JSONL
  if (editorPreviewEl) {
    var lines = content.trim().split("\n").filter(function (l) { return l.trim(); });
    if (lines.length === 0) {
      editorPreviewEl.innerHTML = "<p style=\"opacity:0.5\">No data entries yet</p>";
    } else {
      var rows = [];
      var allKeys = [];
      var keySet = {};
      for (var i = 0; i < lines.length; i++) {
        try {
          var obj = JSON.parse(lines[i]);
          rows.push(obj);
          var keys = Object.keys(obj);
          for (var k = 0; k < keys.length; k++) {
            if (!keySet[keys[k]]) { keySet[keys[k]] = true; allKeys.push(keys[k]); }
          }
        } catch (e) { /* skip malformed lines */ }
      }
      var html = "<table class=\"mate-knowledge-jsonl-table\"><thead><tr>";
      for (var c = 0; c < allKeys.length; c++) {
        html += "<th>" + escapeHtml(allKeys[c]) + "</th>";
      }
      html += "</tr></thead><tbody>";
      for (var r = 0; r < rows.length; r++) {
        html += "<tr>";
        for (var c = 0; c < allKeys.length; c++) {
          var val = rows[r][allKeys[c]];
          var cell = val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
          html += "<td>" + escapeHtml(cell) + "</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      editorPreviewEl.innerHTML = html;
    }
  }

  renderFileList();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function selectFile(fileName, content) {
  editingFile = fileName || null;
  dirty = false;

  // Restore editor pane (may have been hidden by JSONL viewer)
  if (editorContentEl) editorContentEl.style.display = "";
  if (editorHighlightPre) editorHighlightPre.style.display = "";
  if (editorSaveBtn) editorSaveBtn.style.display = "";

  // Show editor when a file is selected or new file created
  if (containerEl) containerEl.classList.remove("hidden");

  // Update active name / name input group
  if (fileName) {
    if (activeNameEl) { activeNameEl.textContent = fileName.replace(/\.md$/, ""); activeNameEl.classList.remove("hidden"); }
    if (nameGroupEl) nameGroupEl.classList.add("hidden");
  } else {
    if (activeNameEl) activeNameEl.classList.add("hidden");
    if (nameGroupEl) nameGroupEl.classList.remove("hidden");
    if (editorNameEl) editorNameEl.value = "";
  }

  if (editorContentEl) {
    editorContentEl.value = content || "";
    editorContentEl.placeholder = fileName ? "" : "Start writing...";
  }
  if (editorDeleteBtn) {
    editorDeleteBtn.style.display = fileName ? "" : "none";
  }
  if (editorSaveBtn) {
    editorSaveBtn.disabled = true;
  }

  updateHighlight();
  updatePreview();
  renderFileList();

  if (!fileName && editorNameEl) {
    editorNameEl.focus();
  } else if (editorContentEl) {
    editorContentEl.focus();
  }
}

function updateHighlight() {
  if (!editorHighlightEl || !editorContentEl) return;
  var text = editorContentEl.value + "\n";
  // Reset completely: hljs skips elements it already processed
  editorHighlightEl.className = "language-markdown";
  editorHighlightEl.removeAttribute("data-highlighted");
  editorHighlightEl.textContent = text;
  if (window.hljs) {
    window.hljs.highlightElement(editorHighlightEl);
  }
}

function syncHighlightScroll() {
  if (!editorHighlightPre || !editorContentEl) return;
  editorHighlightPre.scrollTop = editorContentEl.scrollTop;
  editorHighlightPre.scrollLeft = editorContentEl.scrollLeft;
}

function updatePreview() {
  if (!editorPreviewEl || !editorContentEl) return;
  var text = editorContentEl.value;
  if (!text.trim()) {
    editorPreviewEl.innerHTML = "";
    return;
  }
  editorPreviewEl.innerHTML = renderMarkdown(text);
  highlightCodeBlocks(editorPreviewEl);
}

function saveKnowledge() {
  if (!editorNameEl || !editorContentEl) return;
  var name = (editingFile || editorNameEl.value.trim().replace(/\.md$/i, "") + ".md");
  var content = editorContentEl.value;
  if (!name || name === ".md") {
    editorNameEl.style.outline = "2px solid var(--error, #ff5555)";
    setTimeout(function () { editorNameEl.style.outline = ""; }, 1500);
    return;
  }
  var ws = getMateWs ? getMateWs() : null;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "knowledge_save", name: name, content: content }));
  }
  editingFile = name;
  dirty = false;
  if (editorSaveBtn) editorSaveBtn.disabled = true;
  if (activeNameEl) { activeNameEl.textContent = name.replace(/\.md$/, ""); activeNameEl.classList.remove("hidden"); }
  if (nameGroupEl) nameGroupEl.classList.add("hidden");
  if (editorDeleteBtn) editorDeleteBtn.style.display = "";
}

// --- Format Popover ---

var formatPopover = null;
var popoverHideTimer = null;

var FORMAT_ACTIONS = [
  { icon: "bold", label: "Bold", wrap: ["**", "**"] },
  { icon: "italic", label: "Italic", wrap: ["*", "*"] },
  { icon: "strikethrough", label: "Strikethrough", wrap: ["~~", "~~"] },
  { icon: "code", label: "Code", wrap: ["`", "`"] },
  { icon: "link", label: "Link", wrap: ["[", "](url)"] },
  { icon: "heading-1", label: "Heading", prefix: "# " },
  { icon: "list", label: "List", prefix: "- " },
  { icon: "quote", label: "Quote", prefix: "> " },
];

function initFormatPopover(textarea) {
  // Create popover element
  formatPopover = document.createElement("div");
  formatPopover.className = "mate-format-popover";
  formatPopover.style.display = "none";

  for (var i = 0; i < FORMAT_ACTIONS.length; i++) {
    var action = FORMAT_ACTIONS[i];
    var btn = document.createElement("button");
    btn.className = "mate-format-btn";
    btn.title = action.label;
    btn.innerHTML = iconHtml(action.icon);
    btn.dataset.index = String(i);
    btn.addEventListener("mousedown", function (e) {
      e.preventDefault(); // prevent textarea blur
      var idx = parseInt(this.dataset.index);
      applyFormat(textarea, FORMAT_ACTIONS[idx]);
    });
    formatPopover.appendChild(btn);
  }

  document.body.appendChild(formatPopover);
  refreshIcons(formatPopover);

  textarea.addEventListener("mouseup", function () {
    setTimeout(function () { checkSelection(textarea); }, 10);
  });
  textarea.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") {
      checkSelection(textarea);
    }
  });

  textarea.addEventListener("blur", function () {
    popoverHideTimer = setTimeout(hidePopover, 150);
  });
  textarea.addEventListener("focus", function () {
    if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
  });

  document.addEventListener("scroll", hidePopover, true);
}

function checkSelection(textarea) {
  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  if (start === end || !formatPopover) {
    hidePopover();
    return;
  }
  showPopover(textarea);
}

function showPopover(textarea) {
  if (!formatPopover) return;

  // Position above the textarea selection
  // We approximate position using a mirror div technique
  var rect = textarea.getBoundingClientRect();
  var lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
  var paddingTop = parseInt(getComputedStyle(textarea).paddingTop) || 0;
  var paddingLeft = parseInt(getComputedStyle(textarea).paddingLeft) || 0;
  var fontSize = parseInt(getComputedStyle(textarea).fontSize) || 13;

  // Get text before selection to calculate approximate position
  var text = textarea.value;
  var start = textarea.selectionStart;
  var textBefore = text.substring(0, start);
  var lines = textBefore.split("\n");
  var currentLine = lines.length - 1;
  var charInLine = lines[lines.length - 1].length;

  // Approximate character width (monospace)
  var charWidth = fontSize * 0.6;

  var scrollTop = textarea.scrollTop;
  var x = rect.left + paddingLeft + (charWidth * Math.min(charInLine, 40));
  var y = rect.top + paddingTop + (currentLine * lineHeight) - scrollTop - 8;

  // Clamp to viewport
  var popoverWidth = 280;
  if (x + popoverWidth / 2 > window.innerWidth) x = window.innerWidth - popoverWidth / 2 - 8;
  if (x - popoverWidth / 2 < 8) x = popoverWidth / 2 + 8;
  if (y < 40) y = rect.top + paddingTop + ((currentLine + 1) * lineHeight) - scrollTop + 28;

  formatPopover.style.display = "flex";
  formatPopover.style.left = x + "px";
  formatPopover.style.top = y + "px";
}

function hidePopover() {
  if (formatPopover) formatPopover.style.display = "none";
}

function applyFormat(textarea, action) {
  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  var selected = textarea.value.substring(start, end);

  var replacement;

  if (action.wrap) {
    replacement = action.wrap[0] + selected + action.wrap[1];
  } else if (action.prefix) {
    var lines = selected.split("\n");
    replacement = lines.map(function (line) { return action.prefix + line; }).join("\n");
  }

  // Use execCommand to preserve native undo/redo stack
  textarea.focus();
  textarea.setSelectionRange(start, end);
  document.execCommand("insertText", false, replacement);

  hidePopover();
}
