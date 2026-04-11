/**
 * Scheduler history module — Run history rendering and schedule event handlers.
 *
 * Extracted from scheduler.js to keep module sizes manageable.
 */

import { renderMarkdown } from './markdown.js';

var histCtx = null;

// --- Init ---

export function initSchedulerHistory(_histCtx) {
  histCtx = _histCtx;
}

// --- History rendering ---

export function renderHistory(runs) {
  var el = document.getElementById("sched-history");
  if (!el || !runs || runs.length === 0) { if (el) el.innerHTML = '<div class="sched-history-empty">No runs yet</div>'; return; }
  var html = "";
  var sorted = runs.slice().reverse();
  for (var i = 0; i < sorted.length; i++) {
    var run = sorted[i];
    html += '<div class="sched-history-item"><span class="sched-history-dot ' + (run.result || "") + '"></span>';
    html += '<span class="sched-history-date">' + histCtx.formatDateTime(new Date(run.startedAt)) + '</span>';
    html += '<span class="sched-history-result">' + (run.result || "?") + '</span>';
    html += '<span class="sched-history-iterations">' + (run.iterations || 0) + ' iter</span></div>';
  }
  el.innerHTML = html;
}

// --- Message handlers ---

export function handleLoopRegistryUpdated(msg) {
  histCtx.setRecords(msg.records || []);
  if (histCtx.isPanelOpen()) {
    histCtx.renderSidebar();
    var mode = histCtx.getCurrentMode();
    if (mode === "calendar") histCtx.render();
    else if (mode === "detail") histCtx.renderDetail();
  }
}

export function handleLoopRegistryFiles(msg) {
  if (!histCtx.isPanelOpen() || histCtx.getCurrentMode() !== "detail") return;
  if (msg.id !== histCtx.getSelectedTaskId()) return;
  var bodyEl = document.getElementById("scheduler-detail-body");
  if (!bodyEl) return;
  var contentDetailEl = histCtx.getContentDetailEl();
  var activeTab = contentDetailEl ? contentDetailEl.querySelector(".scheduler-detail-tab.active") : null;
  var tab = activeTab ? activeTab.dataset.tab : "prompt";
  if (tab === "prompt") {
    bodyEl.innerHTML = msg.prompt ? '<div class="md-content">' + renderMarkdown(msg.prompt) + '</div>' : '<div class="scheduler-empty">No PROMPT.md found</div>';
  } else if (tab === "judge") {
    bodyEl.innerHTML = msg.judge ? '<div class="md-content">' + renderMarkdown(msg.judge) + '</div>' : '<div class="scheduler-empty">No JUDGE.md found</div>';
  }
  // Disable "Run now" if PROMPT.md is missing
  var runBtn = contentDetailEl ? contentDetailEl.querySelector('[data-action="run"]') : null;
  if (runBtn) {
    var filesReady = !!msg.prompt;
    runBtn.disabled = !filesReady;
    runBtn.title = filesReady ? "Run now" : "PROMPT.md is required to run";
  }
}

export function handleScheduleRunStarted(msg) {
  if (histCtx.isPanelOpen()) histCtx.render();
}

export function handleScheduleRunFinished(msg) {
  histCtx.send({ type: "loop_registry_list" });
}

export function handleLoopScheduled(msg) {
  // A loop was just registered as scheduled (from approval bar)
  histCtx.send({ type: "loop_registry_list" });
}
