import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { openSearch as openSessionSearch } from './session-search.js';

var ctx;
var paletteEl = null;
var inputEl = null;
var resultsEl = null;
var activeIndex = -1;
var items = [];
var debounceTimer = null;
var abortCtrl = null;
var pendingNav = null;

export function initCommandPalette(_ctx) {
  ctx = _ctx;
  buildDOM();
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (isCommandPaletteOpen()) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    }
  });
}

export function isCommandPaletteOpen() {
  return paletteEl && !paletteEl.classList.contains("hidden");
}

export function openCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.remove("hidden");
  inputEl.value = "";
  activeIndex = -1;
  items = [];
  resultsEl.innerHTML = '<div class="cmd-palette-loading">Loading...</div>';
  inputEl.focus();
  fetchResults("");
}

export function closeCommandPalette() {
  if (!paletteEl) return;
  paletteEl.classList.add("hidden");
  inputEl.value = "";
  resultsEl.innerHTML = "";
  items = [];
  activeIndex = -1;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
}

// Called from app.js after session_list arrives on new project connection
export function handlePaletteSessionSwitch() {
  if (!pendingNav) return;
  var nav = pendingNav;
  pendingNav = null;
  if (ctx.currentSlug && ctx.currentSlug() === nav.slug) {
    ctx.selectSession(nav.sessionId);
    if (nav.query) {
      setTimeout(function () { openSessionSearch(nav.query); }, 400);
    }
  }
}

function buildDOM() {
  paletteEl = document.createElement("div");
  paletteEl.className = "cmd-palette hidden";
  paletteEl.innerHTML =
    '<div class="cmd-palette-backdrop"></div>' +
    '<div class="cmd-palette-dialog">' +
      '<div class="cmd-palette-input-row">' +
        '<i data-lucide="search"></i>' +
        '<input class="cmd-palette-input" type="text" placeholder="Search sessions across all projects..." autocomplete="off" spellcheck="false" />' +
        '<kbd class="cmd-palette-kbd">ESC</kbd>' +
      '</div>' +
      '<div class="cmd-palette-results"></div>' +
      '<div class="cmd-palette-footer">' +
        '<span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate</span>' +
        '<span><kbd>Enter</kbd> open</span>' +
      '</div>' +
    '</div>';

  document.body.appendChild(paletteEl);
  refreshIcons();

  inputEl = paletteEl.querySelector(".cmd-palette-input");
  resultsEl = paletteEl.querySelector(".cmd-palette-results");

  // Backdrop click
  paletteEl.querySelector(".cmd-palette-backdrop").addEventListener("click", function () {
    closeCommandPalette();
  });

  // Input events
  inputEl.addEventListener("input", function () {
    var q = inputEl.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      fetchResults(q);
    }, 250);
  });

  // Keyboard navigation
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) {
        selectItem(items[activeIndex]);
      }
      return;
    }
  });

  // Prevent dialog click from closing
  paletteEl.querySelector(".cmd-palette-dialog").addEventListener("click", function (e) {
    e.stopPropagation();
  });
}

function fetchResults(query) {
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  abortCtrl = new AbortController();
  var url = "/api/palette/search?q=" + encodeURIComponent(query.trim());
  fetch(url, { signal: abortCtrl.signal })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      abortCtrl = null;
      renderResults(data.results || [], query.trim());
    })
    .catch(function (err) {
      if (err.name === "AbortError") return;
      abortCtrl = null;
      resultsEl.innerHTML = '<div class="cmd-palette-empty">Search failed</div>';
    });
}

function renderResults(results, query) {
  items = results;
  activeIndex = -1;

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="cmd-palette-empty">' +
      (query ? "No results found" : "No recent sessions") + '</div>';
    return;
  }

  // Group by project
  var groups = [];
  var groupMap = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var key = r.projectSlug;
    if (!groupMap[key]) {
      groupMap[key] = { slug: key, title: r.projectTitle, icon: r.projectIcon, items: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].items.push(r);
  }

  var html = "";
  var flatIndex = 0;
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var label = escapeHtml(group.icon ? group.icon + " " + (group.title || group.slug) : (group.title || group.slug));
    html += '<div class="cmd-palette-group-label">' + label + '</div>';
    for (var j = 0; j < group.items.length; j++) {
      var item = group.items[j];
      var title = escapeHtml(item.sessionTitle || "New Session");
      var snippet = item.snippet ? escapeHtml(item.snippet) : "";
      html += '<div class="cmd-palette-item" data-index="' + flatIndex + '">' +
        '<div class="cmd-palette-item-icon">' + (group.icon || '<i data-lucide="message-square"></i>') + '</div>' +
        '<div class="cmd-palette-item-body">' +
          '<div class="cmd-palette-item-title">' + title + '</div>' +
          '<div class="cmd-palette-item-meta">' +
            (snippet ? '<span class="cmd-palette-item-snippet">' + snippet + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cmd-palette-item-arrow"><i data-lucide="arrow-right"></i></div>' +
      '</div>';
      flatIndex++;
    }
  }

  resultsEl.innerHTML = html;
  refreshIcons();

  // Click handlers
  var itemEls = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var k = 0; k < itemEls.length; k++) {
    (function (el) {
      el.addEventListener("click", function () {
        var idx = parseInt(el.getAttribute("data-index"), 10);
        if (idx >= 0 && idx < items.length) selectItem(items[idx]);
      });
      el.addEventListener("mouseenter", function () {
        var idx = parseInt(el.getAttribute("data-index"), 10);
        setActive(idx, true);
      });
    })(itemEls[k]);
  }
}

function setActive(idx, skipScroll) {
  if (items.length === 0) return;
  if (idx < 0) idx = items.length - 1;
  if (idx >= items.length) idx = 0;
  activeIndex = idx;

  var els = resultsEl.querySelectorAll(".cmd-palette-item");
  for (var i = 0; i < els.length; i++) {
    els[i].classList.toggle("active", i === idx);
  }
  if (!skipScroll && els[idx]) {
    els[idx].scrollIntoView({ block: "nearest" });
  }
}

function selectItem(item) {
  var query = inputEl.value.trim();
  closeCommandPalette();
  var slug = item.projectSlug;
  var sessionId = item.sessionId;

  if (ctx.currentSlug && ctx.currentSlug() === slug) {
    // Same project, just switch session
    ctx.selectSession(sessionId);
    if (query) {
      setTimeout(function () { openSessionSearch(query); }, 400);
    }
  } else {
    // Different project: store pending nav, then switch
    pendingNav = { slug: slug, sessionId: sessionId, query: query || null };
    ctx.switchProject(slug);
  }
}
