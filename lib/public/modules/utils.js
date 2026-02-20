export function showToast(message, level, detail) {
  var el = document.createElement("div");
  el.className = "toast";
  if (level) el.classList.add("toast-" + level);
  el.textContent = message;
  if (detail) {
    var detailEl = document.createElement("div");
    detailEl.style.cssText = "font-size:11px;opacity:0.7;margin-top:4px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    detailEl.textContent = detail.split("\n")[0];
    el.appendChild(detailEl);
  }
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.classList.add("visible"); });
  var duration = level === "warn" ? 5000 : 1500;
  setTimeout(function () {
    el.classList.remove("visible");
    setTimeout(function () { el.remove(); }, 300);
  }, duration);
}

export function copyToClipboard(text) {
  var p;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    p = navigator.clipboard.writeText(text);
  } else {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    p = Promise.resolve();
  }
  return p.then(function () { showToast("Copied to clipboard"); });
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
