// admin.js — Admin management panel for multi-user mode
// Provides user management, invite links, and project access control
import { iconHtml, refreshIcons } from './icons.js';
import { showToast, copyToClipboard, escapeHtml } from './utils.js';

var ctx = null;
var panelEl = null;
var isOpen = false;
var currentTab = "users";
var cachedUsers = [];
var cachedInvites = [];
var cachedProjects = [];
var meInfo = null;

// --- API helpers ---
function apiGet(url) {
  return fetch(url).then(function (r) { return r.json(); });
}

function apiPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(function (r) { return r.json(); });
}

function apiPut(url, body) {
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json(); });
}

function apiDelete(url) {
  return fetch(url, { method: "DELETE" }).then(function (r) { return r.json(); });
}

// --- Init ---
export function initAdmin(appCtx) {
  ctx = appCtx;
}

export function isAdminPanelOpen() {
  return isOpen;
}

// Check if user is admin and multi-user mode is active
export function checkAdminAccess() {
  return apiGet("/api/me").then(function (data) {
    meInfo = data;
    return data.multiUser && data.user && data.user.role === "admin";
  }).catch(function () { return false; });
}

// --- Panel lifecycle ---
export function openAdminPanel() {
  if (isOpen) return;
  isOpen = true;

  panelEl = document.createElement("div");
  panelEl.className = "admin-panel";
  panelEl.innerHTML = buildPanelHtml();
  document.body.appendChild(panelEl);

  // Bind events
  panelEl.querySelector(".admin-close-btn").addEventListener("click", closeAdminPanel);
  var tabs = panelEl.querySelectorAll(".admin-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () {
      switchTab(this.dataset.tab);
    });
  }

  // ESC to close
  panelEl._escHandler = function (e) {
    if (e.key === "Escape") closeAdminPanel();
  };
  document.addEventListener("keydown", panelEl._escHandler);

  refreshIcons(panelEl);
  switchTab("users");
}

export function closeAdminPanel() {
  if (!isOpen || !panelEl) return;
  isOpen = false;
  if (panelEl._escHandler) {
    document.removeEventListener("keydown", panelEl._escHandler);
  }
  panelEl.remove();
  panelEl = null;
}

function buildPanelHtml() {
  return '<div class="admin-overlay"></div>' +
    '<div class="admin-content">' +
    '<div class="admin-header">' +
    '<h2>Admin</h2>' +
    '<button class="admin-close-btn">' + iconHtml("x") + '</button>' +
    '</div>' +
    '<div class="admin-tabs">' +
    '<button class="admin-tab active" data-tab="users">Users</button>' +
    '<button class="admin-tab" data-tab="invites">Invites</button>' +
    '<button class="admin-tab" data-tab="projects">Projects</button>' +
    '</div>' +
    '<div class="admin-body" id="admin-body"></div>' +
    '</div>';
}

function switchTab(tab) {
  currentTab = tab;
  var tabs = panelEl.querySelectorAll(".admin-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.tab === tab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
  loadTab(tab);
}

function loadTab(tab) {
  var body = panelEl.querySelector("#admin-body");
  body.innerHTML = '<div class="admin-loading">Loading...</div>';

  if (tab === "users") {
    loadUsersTab(body);
  } else if (tab === "invites") {
    loadInvitesTab(body);
  } else if (tab === "projects") {
    loadProjectsTab(body);
  }
}

// --- Users Tab ---
function loadUsersTab(body) {
  apiGet("/api/admin/users").then(function (data) {
    cachedUsers = data.users || [];
    renderUsersTab(body);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load users</div>';
  });
}

function renderUsersTab(body) {
  var html = '<div class="admin-section-header">' +
    '<h3>Users (' + cachedUsers.length + ')</h3>' +
    '</div>';

  html += '<div class="admin-user-list">';
  for (var i = 0; i < cachedUsers.length; i++) {
    var u = cachedUsers[i];
    var isMe = meInfo && meInfo.user && meInfo.user.id === u.id;
    var created = new Date(u.createdAt).toLocaleDateString();
    html += '<div class="admin-user-item">';
    html += '<div class="admin-user-info">';
    html += '<div class="admin-user-name">';
    html += '<strong>' + escapeHtml(u.displayName || u.username) + '</strong>';
    if (u.role === "admin") html += ' <span class="admin-badge">admin</span>';
    if (isMe) html += ' <span class="admin-you-badge">you</span>';
    html += '</div>';
    html += '<div class="admin-user-meta">@' + escapeHtml(u.username) + ' · joined ' + created + '</div>';
    html += '</div>';
    if (!isMe && u.role !== "admin") {
      html += '<button class="admin-remove-btn" data-user-id="' + u.id + '" title="Remove user">' + iconHtml("trash-2") + '</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  // Bind remove buttons
  var removeBtns = body.querySelectorAll(".admin-remove-btn");
  for (var j = 0; j < removeBtns.length; j++) {
    removeBtns[j].addEventListener("click", function () {
      var userId = this.dataset.userId;
      var user = cachedUsers.find(function (u) { return u.id === userId; });
      var name = user ? (user.displayName || user.username) : "this user";
      if (confirm("Remove " + name + "? This cannot be undone.")) {
        removeUser(userId);
      }
    });
  }
}

function removeUser(userId) {
  apiDelete("/api/admin/users/" + userId).then(function (data) {
    if (data.ok) {
      showToast("User removed");
      loadTab("users");
    } else {
      showToast(data.error || "Failed to remove user");
    }
  }).catch(function () {
    showToast("Failed to remove user");
  });
}

// --- Invites Tab ---
function loadInvitesTab(body) {
  apiGet("/api/admin/invites").then(function (data) {
    cachedInvites = (data.invites || []).filter(function (inv) {
      return !inv.used && inv.expiresAt > Date.now();
    });
    renderInvitesTab(body);
  }).catch(function () {
    body.innerHTML = '<div class="admin-error">Failed to load invites</div>';
  });
}

function renderInvitesTab(body) {
  var html = '<div class="admin-section-header">' +
    '<h3>Invite Links</h3>' +
    '<button class="admin-action-btn" id="admin-create-invite">' + iconHtml("plus") + ' Create Invite</button>' +
    '</div>';

  if (cachedInvites.length === 0) {
    html += '<div class="admin-empty">No active invites. Create one to add a new user.</div>';
  } else {
    html += '<div class="admin-invite-list">';
    for (var i = 0; i < cachedInvites.length; i++) {
      var inv = cachedInvites[i];
      var expiresIn = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / (60 * 60 * 1000)));
      html += '<div class="admin-invite-item">';
      html += '<div class="admin-invite-info">';
      html += '<code class="admin-invite-code">' + escapeHtml(inv.code.substring(0, 8)) + '...</code>';
      html += '<span class="admin-invite-expiry">expires in ' + expiresIn + 'h</span>';
      html += '</div>';
      html += '<button class="admin-copy-link-btn" data-code="' + escapeHtml(inv.code) + '" title="Copy link">' + iconHtml("copy") + '</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  body.innerHTML = html;
  refreshIcons(body);

  // Create invite
  var createBtn = body.querySelector("#admin-create-invite");
  if (createBtn) {
    createBtn.addEventListener("click", function () {
      createInvite();
    });
  }

  // Copy link buttons
  var copyBtns = body.querySelectorAll(".admin-copy-link-btn");
  for (var j = 0; j < copyBtns.length; j++) {
    copyBtns[j].addEventListener("click", function () {
      var code = this.dataset.code;
      var url = location.origin + "/invite/" + code;
      copyToClipboard(url).then(function () {
        showToast("Invite link copied");
      });
    });
  }
}

function createInvite() {
  apiPost("/api/admin/invites").then(function (data) {
    if (data.ok && data.url) {
      copyToClipboard(data.url).then(function () {
        showToast("Invite link created and copied!");
      }).catch(function () {
        showToast("Invite created: " + data.url);
      });
      loadTab("invites");
    } else {
      showToast(data.error || "Failed to create invite");
    }
  }).catch(function () {
    showToast("Failed to create invite");
  });
}

// --- Projects Tab ---
function loadProjectsTab(body) {
  // We need the project list from ctx — use the cached project list from sidebar
  var projectList = (ctx && ctx.projectList) || [];
  cachedProjects = projectList;

  if (projectList.length === 0) {
    body.innerHTML = '<div class="admin-empty">No projects registered.</div>';
    return;
  }

  // Load access info for each project
  var promises = projectList.map(function (p) {
    return apiGet("/api/admin/projects/" + p.slug + "/access").then(function (access) {
      return { slug: p.slug, title: p.title || p.project || p.slug, visibility: access.visibility || "public", allowedUsers: access.allowedUsers || [] };
    }).catch(function () {
      return { slug: p.slug, title: p.title || p.project || p.slug, visibility: "public", allowedUsers: [] };
    });
  });

  Promise.all(promises).then(function (projectAccessList) {
    renderProjectsTab(body, projectAccessList);
  });
}

function renderProjectsTab(body, projectAccessList) {
  var html = '<div class="admin-section-header">' +
    '<h3>Project Access</h3>' +
    '</div>';

  html += '<div class="admin-project-list">';
  for (var i = 0; i < projectAccessList.length; i++) {
    var p = projectAccessList[i];
    var visClass = p.visibility === "private" ? "admin-vis-private" : "admin-vis-public";
    html += '<div class="admin-project-item" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<div class="admin-project-info">';
    html += '<div class="admin-project-name">' + escapeHtml(p.title) + '</div>';
    html += '<div class="admin-project-slug">' + escapeHtml(p.slug) + '</div>';
    html += '</div>';
    html += '<div class="admin-project-controls">';
    html += '<select class="admin-vis-select ' + visClass + '" data-slug="' + escapeHtml(p.slug) + '">';
    html += '<option value="public"' + (p.visibility === "public" ? " selected" : "") + '>Public</option>';
    html += '<option value="private"' + (p.visibility === "private" ? " selected" : "") + '>Private</option>';
    html += '</select>';
    if (p.visibility === "private") {
      html += '<button class="admin-manage-users-btn" data-slug="' + escapeHtml(p.slug) + '">' + iconHtml("users") + '</button>';
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  body.innerHTML = html;
  refreshIcons(body);

  // Bind visibility selects
  var visSelects = body.querySelectorAll(".admin-vis-select");
  for (var j = 0; j < visSelects.length; j++) {
    visSelects[j].addEventListener("change", function () {
      var slug = this.dataset.slug;
      var visibility = this.value;
      setProjectVisibility(slug, visibility);
    });
  }

  // Bind manage users buttons
  var manageUserBtns = body.querySelectorAll(".admin-manage-users-btn");
  for (var k = 0; k < manageUserBtns.length; k++) {
    manageUserBtns[k].addEventListener("click", function () {
      var slug = this.dataset.slug;
      showProjectUsersModal(slug);
    });
  }
}

function setProjectVisibility(slug, visibility) {
  apiPut("/api/admin/projects/" + slug + "/visibility", { visibility: visibility }).then(function (data) {
    if (data.ok) {
      showToast("Visibility updated");
      loadTab("projects");
    } else {
      showToast(data.error || "Failed to update visibility");
    }
  }).catch(function () {
    showToast("Failed to update visibility");
  });
}

function showProjectUsersModal(slug) {
  // Load users and project access
  Promise.all([
    apiGet("/api/admin/users"),
    apiGet("/api/admin/projects/" + slug + "/access"),
  ]).then(function (results) {
    var allUsers = results[0].users || [];
    var access = results[1];
    var allowed = access.allowedUsers || [];

    var modal = document.createElement("div");
    modal.className = "admin-modal-overlay";

    var html = '<div class="admin-modal">';
    html += '<div class="admin-modal-header">';
    html += '<h3>Manage Access: ' + escapeHtml(slug) + '</h3>';
    html += '<button class="admin-modal-close">' + iconHtml("x") + '</button>';
    html += '</div>';
    html += '<div class="admin-modal-body">';
    html += '<p class="admin-modal-desc">Select users who can access this private project:</p>';

    for (var i = 0; i < allUsers.length; i++) {
      var u = allUsers[i];
      if (u.role === "admin") continue; // admin always has access
      var checked = allowed.indexOf(u.id) >= 0 ? " checked" : "";
      html += '<label class="admin-user-check">';
      html += '<input type="checkbox" value="' + u.id + '"' + checked + '>';
      html += '<span>' + escapeHtml(u.displayName || u.username) + ' <small>@' + escapeHtml(u.username) + '</small></span>';
      html += '</label>';
    }

    html += '</div>';
    html += '<div class="admin-modal-footer">';
    html += '<button class="admin-modal-save">Save</button>';
    html += '<button class="admin-modal-cancel">Cancel</button>';
    html += '</div>';
    html += '</div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);
    refreshIcons(modal);

    modal.querySelector(".admin-modal-close").addEventListener("click", function () { modal.remove(); });
    modal.querySelector(".admin-modal-cancel").addEventListener("click", function () { modal.remove(); });
    modal.querySelector(".admin-modal-overlay") || modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector(".admin-modal-save").addEventListener("click", function () {
      var checkboxes = modal.querySelectorAll('input[type="checkbox"]');
      var selectedUsers = [];
      for (var ci = 0; ci < checkboxes.length; ci++) {
        if (checkboxes[ci].checked) selectedUsers.push(checkboxes[ci].value);
      }
      apiPut("/api/admin/projects/" + slug + "/users", { allowedUsers: selectedUsers }).then(function (data) {
        if (data.ok) {
          showToast("Project access updated");
          modal.remove();
          loadTab("projects");
        } else {
          showToast(data.error || "Failed to update access");
        }
      }).catch(function () {
        showToast("Failed to update access");
      });
    });
  }).catch(function () {
    showToast("Failed to load project access info");
  });
}
