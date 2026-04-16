// user-settings.js — Modal dialog for user settings
// Account management and logout

import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { toggleDarkMode, getCurrentTheme, getChatLayout, setChatLayout } from './theme.js';
import { showEmailSetupModal, getEmailAccountListCache } from './context-sources.js';

var ctx = null;
var settingsEl = null;
var openBtn = null;
var closeBtn = null;
var backdrop = null;
var navItems = null;
var sections = null;


export function initUserSettings(appCtx) {
  ctx = appCtx;
  settingsEl = document.getElementById('user-settings');
  openBtn = document.getElementById('user-settings-btn');
  closeBtn = document.getElementById('user-settings-close');
  backdrop = document.getElementById('user-settings-backdrop');

  if (!settingsEl || !openBtn) return;

  navItems = settingsEl.querySelectorAll('.us-nav-item');
  sections = settingsEl.querySelectorAll('.us-section');

  openBtn.addEventListener('click', function () {
    openUserSettings();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isUserSettingsOpen()) {
      closeUserSettings();
    }
  });

  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function () {
      var section = this.dataset.section;
      switchSection(section);
    });
  }

  // Mobile nav dropdown
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) {
    navDropdown.addEventListener('change', function () {
      switchSection(this.value);
    });
  }

  // PIN save button
  var pinInput = document.getElementById('us-pin-input');
  var pinSave = document.getElementById('us-pin-save');
  if (pinInput && pinSave) {
    function validatePin() {
      pinSave.disabled = !/^\d{6}$/.test(pinInput.value);
    }
    pinInput.addEventListener('input', validatePin);
    pinInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    pinInput.addEventListener('keydown', stopProp);
    pinInput.addEventListener('keypress', stopProp);
    pinSave.addEventListener('click', function () {
      savePin(pinInput.value);
    });
  }

  // Auto-continue toggle
  var autoContinueToggle = document.getElementById('us-auto-continue');
  if (autoContinueToggle) {
    autoContinueToggle.addEventListener('change', function () {
      fetch('/api/user/auto-continue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: this.checked }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok) showToast(data.autoContinueOnRateLimit ? 'Auto-continue on' : 'Auto-continue off');
      }).catch(function () {});
    });
  }

  // Theme switcher (Light / Dark)
  var themeSwitcher = document.getElementById('us-theme-switcher');
  if (themeSwitcher) {
    var themeBtns = themeSwitcher.querySelectorAll('.layout-option');
    for (var ti = 0; ti < themeBtns.length; ti++) {
      themeBtns[ti].addEventListener('click', function () {
        var mode = this.dataset.theme;
        var current = getCurrentTheme();
        var currentMode = (current && current.variant) || 'dark';
        if (mode !== currentMode) toggleDarkMode();
        for (var tj = 0; tj < themeBtns.length; tj++) {
          themeBtns[tj].classList.toggle('selected', themeBtns[tj].dataset.theme === mode);
        }
      });
    }
  }

  // Layout switcher (Bubble / Channel)
  var layoutSwitcher = document.getElementById('us-layout-switcher');
  if (layoutSwitcher) {
    var layoutBtns = layoutSwitcher.querySelectorAll('.layout-option');
    for (var li = 0; li < layoutBtns.length; li++) {
      layoutBtns[li].addEventListener('click', function () {
        var layout = this.dataset.layout;
        setChatLayout(layout);
        for (var lj = 0; lj < layoutBtns.length; lj++) {
          layoutBtns[lj].classList.toggle('selected', layoutBtns[lj].dataset.layout === layout);
        }
        // Save to server
        fetch('/api/user/chat-layout', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: layout }),
        }).catch(function () {});
      });
    }
  }

  // Logout button
  var logoutBtn = document.getElementById('us-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () {
        window.location.reload();
      }).catch(function () {
        window.location.reload();
      });
    });
  }

  // Email: Add Account button
  var emailAddBtn = document.getElementById('us-email-add');
  if (emailAddBtn) {
    emailAddBtn.addEventListener('click', function () {
      showEmailSetupModal();
    });
  }
}

function openUserSettings() {
  settingsEl.classList.remove('hidden');
  openBtn.classList.add('active');
  refreshIcons(settingsEl);
  populateAccount();
  switchSection('us-account');
}

export function closeUserSettings() {
  settingsEl.classList.add('hidden');
  openBtn.classList.remove('active');
}

export function isUserSettingsOpen() {
  return settingsEl && !settingsEl.classList.contains('hidden');
}

function switchSection(sectionName) {
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].classList.toggle('active', navItems[i].dataset.section === sectionName);
  }
  for (var j = 0; j < sections.length; j++) {
    sections[j].classList.toggle('active', sections[j].dataset.section === sectionName);
  }
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) navDropdown.value = sectionName;
  if (sectionName === 'us-email') renderEmailSettings();
}

function stopProp(e) {
  e.stopPropagation();
}

// --- Account population ---

function populateAccount() {
  fetch('/api/profile').then(function (r) {
    if (!r.ok) return null;
    return r.json();
  }).then(function (data) {
    if (!data) return;
    var usernameEl = document.getElementById('us-username');
    if (usernameEl && data.username) {
      usernameEl.textContent = data.username;
    }
    // Hide account section in single-user mode (no username)
    var accountNav = settingsEl.querySelector('[data-section="us-account"]');
    if (accountNav && !data.username) {
      accountNav.style.display = 'none';
    }
    // Auto-continue toggle
    var acToggle = document.getElementById('us-auto-continue');
    if (acToggle) acToggle.checked = !!data.autoContinueOnRateLimit;
    // Theme switcher
    var tSwitcher = document.getElementById('us-theme-switcher');
    if (tSwitcher) {
      var currentMode = (getCurrentTheme() && getCurrentTheme().variant) || 'dark';
      var tBtns = tSwitcher.querySelectorAll('.layout-option');
      for (var ti = 0; ti < tBtns.length; ti++) {
        tBtns[ti].classList.toggle('selected', tBtns[ti].dataset.theme === currentMode);
      }
    }
    // Layout switcher: sync from server response
    // Sync mate onboarding state from server
    if (data.mateOnboardingShown) {
      try { localStorage.setItem("clay-mate-onboarding-shown", "1"); } catch (e) {}
    }
    if (data.chatLayout) {
      setChatLayout(data.chatLayout); // update local cache + CSS
    }
    var lSwitcher = document.getElementById('us-layout-switcher');
    if (lSwitcher) {
      var currentLayout = getChatLayout();
      var lBtns = lSwitcher.querySelectorAll('.layout-option');
      for (var li = 0; li < lBtns.length; li++) {
        lBtns[li].classList.toggle('selected', lBtns[li].dataset.layout === currentLayout);
      }
    }
  }).catch(function () {});
}

function savePin(pin) {
  var pinInput = document.getElementById('us-pin-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');

  pinSave.disabled = true;
  pinSave.textContent = 'Saving\u2026';

  fetch('/api/user/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPin: pin }),
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      pinInput.value = '';
      pinSave.textContent = 'Change PIN';
      if (pinMsg) {
        pinMsg.textContent = 'Your PIN has been changed.';
        pinMsg.className = 'us-pin-msg us-pin-msg-ok';
        pinMsg.classList.remove('hidden');
      }
      showToast('PIN changed');
    } else {
      pinSave.disabled = false;
      pinSave.textContent = 'Change PIN';
      if (pinMsg) {
        pinMsg.textContent = data.error || 'Could not change your PIN. Please try again.';
        pinMsg.className = 'us-pin-msg us-pin-msg-err';
        pinMsg.classList.remove('hidden');
      }
    }
  }).catch(function () {
    pinSave.disabled = false;
    pinSave.textContent = 'Change PIN';
    if (pinMsg) {
      pinMsg.textContent = 'Connection lost. Check your network and try again.';
      pinMsg.className = 'us-pin-msg us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
  });
}

// --- Email settings ---

function renderEmailSettings() {
  var listEl = document.getElementById('us-email-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  var accounts = getEmailAccountListCache();
  if (!accounts || accounts.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'settings-field';
    empty.innerHTML = '<div class="us-email-empty">No email accounts connected yet.</div>';
    listEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < accounts.length; i++) {
    var acc = accounts[i];
    var row = document.createElement('div');
    row.className = 'us-email-row';
    row.innerHTML =
      '<div class="us-email-icon">' + providerIcon(acc.provider) + '</div>' +
      '<div class="us-email-info">' +
        '<div class="us-email-addr">' + escHtml(acc.email) + '</div>' +
        '<div class="us-email-provider">' + escHtml(acc.label || acc.provider || 'Custom') + '</div>' +
      '</div>' +
      '<button class="us-email-remove-btn" data-account-id="' + escHtml(acc.id) + '">Remove</button>';

    var removeBtn = row.querySelector('button');
    removeBtn.addEventListener('click', function () {
      var accountId = this.getAttribute('data-account-id');
      if (ctx && ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: 'email_account_remove', accountId: accountId }));
      }
    });

    listEl.appendChild(row);
  }
}

export function refreshEmailSettings() {
  if (isUserSettingsOpen()) renderEmailSettings();
}

var PROVIDER_ICON_PATHS = {
  gmail: '/icons/email/gmail.svg',
  outlook: '/icons/email/outlook.svg',
  yahoo: '/icons/email/yahoo.svg',
};

function providerIcon(provider) {
  var src = PROVIDER_ICON_PATHS[provider];
  if (src) {
    return '<img src="' + src + '" class="us-email-provider-icon" alt="' + provider + '">';
  }
  return '<i data-lucide="mail" class="us-email-provider-icon-fallback"></i>';
}

function escHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
