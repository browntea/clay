var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { CONFIG_DIR } = require("./config");
var _isDevMode = require("./config").isDevMode;

// --- PIN hashing ---

function generateAuthToken(pin) {
  var salt = crypto.randomBytes(16).toString("hex");
  var hash = crypto.scryptSync("clay:" + pin, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPin(pin, storedHash) {
  if (!storedHash) return false;
  // New scrypt format: salt_hex:hash_hex (contains colon)
  if (storedHash.indexOf(":") !== -1) {
    var parts = storedHash.split(":");
    var salt = parts[0];
    var hash = parts[1];
    var derived = crypto.scryptSync("clay:" + pin, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
  }
  // Legacy SHA256 format (no colon)
  var legacyHash = crypto.createHash("sha256").update("clay:" + pin).digest("hex");
  var match = crypto.timingSafeEqual(Buffer.from(legacyHash, "hex"), Buffer.from(storedHash, "hex"));
  return match;
}

// --- TOTP (RFC 6238) ---
var TOTP_SECRET_FILE = path.join(CONFIG_DIR, _isDevMode ? "totp-secret-dev.json" : "totp-secret.json");
var AUTH_MODE_FILE = path.join(CONFIG_DIR, _isDevMode ? "auth-mode-dev.json" : "auth-mode.json");
var _totpSecret = null; // base32-encoded secret, loaded at startup
var _authMode = "pin"; // "pin" | "totp" | "either" | "both"

function base32Decode(str) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var bits = "";
  var decoded = [];
  str = str.replace(/=+$/, "").toUpperCase();
  for (var i = 0; i < str.length; i++) {
    var val = alphabet.indexOf(str.charAt(i));
    if (val === -1) continue;
    bits += ("00000" + val.toString(2)).slice(-5);
  }
  for (var j = 0; j + 8 <= bits.length; j += 8) {
    decoded.push(parseInt(bits.substring(j, j + 8), 2));
  }
  return Buffer.from(decoded);
}

function base32Encode(buf) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var bits = "";
  for (var i = 0; i < buf.length; i++) {
    bits += ("00000000" + buf[i].toString(2)).slice(-8);
  }
  var result = "";
  for (var j = 0; j + 5 <= bits.length; j += 5) {
    result += alphabet.charAt(parseInt(bits.substring(j, j + 5), 2));
  }
  return result;
}

function generateTotpCode(secret, timeStep) {
  var buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(timeStep, 4);
  var hmac = crypto.createHmac("sha1", base32Decode(secret));
  hmac.update(buf);
  var hash = hmac.digest();
  var offset = hash[hash.length - 1] & 0x0F;
  var code = ((hash[offset] & 0x7F) << 24 | hash[offset + 1] << 16 | hash[offset + 2] << 8 | hash[offset + 3]) % 1000000;
  return ("000000" + code).slice(-6);
}

function verifyTotp(code, secret) {
  if (!code || !secret) return false;
  code = String(code).replace(/\s/g, "");
  if (code.length !== 6) return false;
  var timeStep = Math.floor(Date.now() / 30000);
  // Check current window + 1 before and 1 after (clock skew tolerance)
  for (var i = -1; i <= 1; i++) {
    var expected = generateTotpCode(secret, timeStep + i);
    if (code === expected) return true;
  }
  return false;
}

// Convenience: verify a TOTP code against the loaded secret
function verifyTotpCode(code) {
  return verifyTotp(code, _totpSecret);
}

function generateTotpSecret() {
  var buf = crypto.randomBytes(20); // 160-bit secret
  return base32Encode(buf);
}

function loadTotpSecret() {
  try {
    var raw = fs.readFileSync(TOTP_SECRET_FILE, "utf8");
    var data = JSON.parse(raw);
    if (data && data.secret) _totpSecret = data.secret;
  } catch (e) { _totpSecret = null; }
}

function saveTotpSecret(secret) {
  try {
    fs.mkdirSync(path.dirname(TOTP_SECRET_FILE), { recursive: true });
    var tmpPath = TOTP_SECRET_FILE + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify({ secret: secret, createdAt: Date.now() }));
    fs.renameSync(tmpPath, TOTP_SECRET_FILE);
  } catch (e) {}
}

// --- Auth Mode ---

function getAuthMode() {
  return _authMode;
}

function isTotpAvailable() {
  return !!_totpSecret;
}

function loadAuthMode() {
  try {
    var raw = fs.readFileSync(AUTH_MODE_FILE, "utf8");
    var data = JSON.parse(raw);
    if (data && data.mode) {
      var valid = ["pin", "totp", "either", "both"];
      if (valid.indexOf(data.mode) !== -1) {
        _authMode = data.mode;
        return;
      }
    }
  } catch (e) {}
  // Default: "either" if TOTP is configured, "pin" otherwise
  _authMode = _totpSecret ? "either" : "pin";
}

function saveAuthMode(mode) {
  var valid = ["pin", "totp", "either", "both"];
  if (valid.indexOf(mode) === -1) return false;
  _authMode = mode;
  try {
    fs.mkdirSync(path.dirname(AUTH_MODE_FILE), { recursive: true });
    var tmpPath = AUTH_MODE_FILE + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify({ mode: mode, updatedAt: Date.now() }));
    fs.renameSync(tmpPath, AUTH_MODE_FILE);
  } catch (e) {}
  return true;
}

loadTotpSecret();
loadAuthMode();

// --- Cookie helpers ---

function parseCookies(req) {
  var cookies = {};
  var header = req.headers.cookie || "";
  header.split(";").forEach(function (part) {
    var pair = part.trim().split("=");
    if (pair.length === 2) cookies[pair[0]] = pair[1];
  });
  return cookies;
}

function isAuthed(req, authToken) {
  if (!authToken && !_totpSecret) return true;
  if (!authToken && _totpSecret) {
    var cookies = parseCookies(req);
    return cookies["relay_auth"] === "__totp_session__";
  }
  var cookies = parseCookies(req);
  return cookies["relay_auth"] === authToken;
}

// --- PIN rate limiting ---

var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes (base lockout, used for legacy compat)
var PIN_ATTEMPTS_FILE = path.join(CONFIG_DIR, _isDevMode ? "pin-attempts-dev.json" : "pin-attempts.json");
var _onPinAlert = null;

function getLockoutMs(failCount) {
  if (failCount < PIN_MAX_ATTEMPTS) return 0;
  // Progressive tiers: 5-10 → 15min, 11-15 → 1hr, 16-20 → 6hr, 21+ → 24hr
  if (failCount <= 10) return 15 * 60 * 1000;
  if (failCount <= 15) return 60 * 60 * 1000;
  if (failCount <= 20) return 6 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function loadPinAttempts() {
  try {
    var raw = fs.readFileSync(PIN_ATTEMPTS_FILE, "utf8");
    var data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch (e) {}
  return {};
}

function savePinAttempts(pinAttempts) {
  try {
    fs.mkdirSync(path.dirname(PIN_ATTEMPTS_FILE), { recursive: true });
    var tmpPath = PIN_ATTEMPTS_FILE + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(pinAttempts));
    fs.renameSync(tmpPath, PIN_ATTEMPTS_FILE);
  } catch (e) {}
}

function attachAuth(ctx) {
  var users = ctx.users;
  var smtp = ctx.smtp;
  var pages = ctx.pages;
  var tlsOptions = ctx.tlsOptions;
  var osUsers = ctx.osUsers;
  var provisionLinuxUser = ctx.provisionLinuxUser;
  var onUpgradePin = ctx.onUpgradePin;
  var onUserProvisioned = ctx.onUserProvisioned;

  var authToken = ctx.pinHash || null;

  // PIN failure push alert callback
  _onPinAlert = function(ip, count) {
    try {
      var pushModule = require("./push");
      if (pushModule && pushModule.sendPush) {
        pushModule.sendPush({
          title: "PIN brute-force alert",
          body: "IP " + ip + " has " + count + " failed attempts",
          tag: "pin-alert-" + ip,
        });
      }
    } catch (e) {}
  };

  // --- Multi-user auth tokens (persisted to disk) ---
  var TOKENS_FILE = path.join(CONFIG_DIR, _isDevMode ? "auth-tokens-dev.json" : "auth-tokens.json");
  var MULTI_USER_COOKIE = _isDevMode ? "relay_auth_user_dev" : "relay_auth_user";
  var multiUserTokens = {};

  function loadTokens() {
    try {
      var raw = fs.readFileSync(TOKENS_FILE, "utf8");
      var data = JSON.parse(raw);
      if (data && typeof data === "object") {
        multiUserTokens = data;
      }
    } catch (e) {
      multiUserTokens = {};
    }
  }

  function saveTokens() {
    try {
      fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
      var tmpPath = TOKENS_FILE + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(multiUserTokens));
      fs.renameSync(tmpPath, TOKENS_FILE);
    } catch (e) {}
  }

  loadTokens();

  function createMultiUserSession(userId) {
    var token = users.generateUserAuthToken(userId);
    multiUserTokens[token] = userId;
    saveTokens();
    var cookie = MULTI_USER_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : "");
    return { token: token, cookie: cookie };
  }

  function getMultiUserFromReq(req) {
    var cookies = parseCookies(req);
    var token = cookies[MULTI_USER_COOKIE];
    if (!token) return null;
    var userId = multiUserTokens[token];
    if (!userId) return null;
    var user = users.findUserById(userId);
    return user || null;
  }

  function isMultiUserAuthed(req) {
    return !!getMultiUserFromReq(req);
  }

  function revokeUserTokens(userId) {
    var changed = false;
    for (var token in multiUserTokens) {
      if (multiUserTokens[token] === userId) {
        delete multiUserTokens[token];
        changed = true;
      }
    }
    if (changed) saveTokens();
  }

  // --- PIN rate limiting (persisted + progressive lockout) ---
  var pinAttempts = loadPinAttempts();

  function checkPinRateLimit(ip) {
    var entry = pinAttempts[ip];
    if (!entry) return null;
    var lockoutMs = getLockoutMs(entry.count);
    if (lockoutMs > 0) {
      var elapsed = Date.now() - entry.lastAttempt;
      if (elapsed < lockoutMs) {
        return Math.ceil((lockoutMs - elapsed) / 1000);
      }
      // Lockout expired — allow one more attempt but keep count for progressive escalation
    }
    return null;
  }

  function recordPinFailure(ip) {
    if (!pinAttempts[ip]) pinAttempts[ip] = { count: 0, lastAttempt: 0 };
    pinAttempts[ip].count++;
    pinAttempts[ip].lastAttempt = Date.now();
    savePinAttempts(pinAttempts);
    // Push alert on every Nth failure (N = PIN_MAX_ATTEMPTS)
    if (pinAttempts[ip].count >= PIN_MAX_ATTEMPTS && pinAttempts[ip].count % PIN_MAX_ATTEMPTS === 0) {
      if (typeof _onPinAlert === "function") {
        _onPinAlert(ip, pinAttempts[ip].count);
      }
    }
  }

  function clearPinFailures(ip) {
    delete pinAttempts[ip];
    savePinAttempts(pinAttempts);
  }

  // --- Admin password recovery (in-memory, one-time) ---
  var recovery = null;

  function setRecovery(urlPath, password) {
    recovery = { urlPath: urlPath, password: password };
  }

  function clearRecovery() {
    recovery = null;
  }

  function recoveryPageHtml() {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Admin Password Recovery</title>'
      + '<style>'
      + '*{margin:0;padding:0;box-sizing:border-box}'
      + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}'
      + '.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:32px;width:100%;max-width:380px}'
      + 'h1{font-size:18px;font-weight:600;margin-bottom:4px}'
      + '.sub{font-size:13px;color:#737373;margin-bottom:24px}'
      + 'label{display:block;font-size:13px;color:#a3a3a3;margin-bottom:6px}'
      + 'input{width:100%;padding:10px 12px;background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#e5e5e5;font-size:14px;outline:none;margin-bottom:16px}'
      + 'input:focus{border-color:#7c3aed}'
      + 'button{width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}'
      + 'button:hover{background:#6d28d9}'
      + 'button:disabled{opacity:.5;cursor:not-allowed}'
      + '.error{color:#ef4444;font-size:13px;margin-bottom:12px;display:none}'
      + '.success{text-align:center;color:#22c55e;font-size:15px}'
      + '.hidden{display:none}'
      + '</style></head><body>'
      + '<div class="card">'
      + '<div id="step-verify">'
      + '<h1>Admin Recovery</h1>'
      + '<p class="sub">Enter the recovery password shown in your terminal.</p>'
      + '<div id="err-verify" class="error"></div>'
      + '<label for="recovery-pw">Recovery password</label>'
      + '<input id="recovery-pw" type="text" autocomplete="off" spellcheck="false" autofocus>'
      + '<button id="btn-verify">Verify</button>'
      + '</div>'
      + '<div id="step-reset" class="hidden">'
      + '<h1>Reset Admin PIN</h1>'
      + '<p class="sub">Enter a new 6-digit PIN for the admin account.</p>'
      + '<div id="err-reset" class="error"></div>'
      + '<label for="new-pin">New PIN</label>'
      + '<input id="new-pin" type="password" maxlength="6" pattern="\\d{6}" inputmode="numeric" placeholder="6 digits">'
      + '<label for="confirm-pin">Confirm PIN</label>'
      + '<input id="confirm-pin" type="password" maxlength="6" pattern="\\d{6}" inputmode="numeric" placeholder="6 digits">'
      + '<button id="btn-reset">Reset PIN</button>'
      + '</div>'
      + '<div id="step-done" class="hidden">'
      + '<p class="success">PIN has been reset successfully. You can now log in with your new PIN.</p>'
      + '</div>'
      + '</div>'
      + '<script>'
      + 'var pw="";\n'
      + 'document.getElementById("btn-verify").onclick=function(){\n'
      + '  var el=document.getElementById("recovery-pw");\n'
      + '  pw=el.value.trim();\n'
      + '  if(!pw)return;\n'
      + '  this.disabled=true;\n'
      + '  fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({step:"verify",password:pw})})\n'
      + '  .then(function(r){return r.json()}).then(function(d){\n'
      + '    if(d.ok){document.getElementById("step-verify").classList.add("hidden");document.getElementById("step-reset").classList.remove("hidden");document.getElementById("new-pin").focus()}\n'
      + '    else{var e=document.getElementById("err-verify");e.textContent=d.error||"Invalid password";e.style.display="block";document.getElementById("btn-verify").disabled=false}\n'
      + '  }).catch(function(){document.getElementById("btn-verify").disabled=false})\n'
      + '};\n'
      + 'document.getElementById("recovery-pw").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("btn-verify").click()});\n'
      + 'document.getElementById("btn-reset").onclick=function(){\n'
      + '  var pin=document.getElementById("new-pin").value;\n'
      + '  var confirm=document.getElementById("confirm-pin").value;\n'
      + '  var errEl=document.getElementById("err-reset");\n'
      + '  if(!/^\\d{6}$/.test(pin)){errEl.textContent="PIN must be exactly 6 digits";errEl.style.display="block";return}\n'
      + '  if(pin!==confirm){errEl.textContent="PINs do not match";errEl.style.display="block";return}\n'
      + '  this.disabled=true;errEl.style.display="none";\n'
      + '  fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({step:"reset",password:pw,pin:pin})})\n'
      + '  .then(function(r){return r.json()}).then(function(d){\n'
      + '    if(d.ok){document.getElementById("step-reset").classList.add("hidden");document.getElementById("step-done").classList.remove("hidden")}\n'
      + '    else{errEl.textContent=d.error||"Failed";errEl.style.display="block";document.getElementById("btn-reset").disabled=false}\n'
      + '  }).catch(function(){document.getElementById("btn-reset").disabled=false})\n'
      + '};\n'
      + 'document.getElementById("confirm-pin").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("btn-reset").click()});\n'
      + '</script></body></html>';
  }

  // --- Auth page selection ---
  var adminSetupPage = pages.adminSetupPageHtml();
  var loginPage = pages.multiUserLoginPageHtml();
  var smtpLoginPage = pages.smtpLoginPageHtml();

  function getAuthPage() {
    if (!users.isMultiUser()) return pages.pinPageHtml({ authMode: getAuthMode(), pinEnabled: !!authToken });
    if (!users.hasAdmin()) return adminSetupPage;
    if (smtp.isEmailLoginEnabled()) return smtpLoginPage;
    return loginPage;
  }

  function isRequestAuthed(req) {
    if (users.isMultiUser()) return isMultiUserAuthed(req);
    return isAuthed(req, authToken);
  }

  function setAuthToken(hash) {
    authToken = hash;
  }

  // --- Route handler ---

  function handleRequest(req, res, fullUrl) {
    // Admin password recovery
    if (recovery && fullUrl === "/recover/" + recovery.urlPath) {
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(recoveryPageHtml());
        return true;
      }
      if (req.method === "POST") {
        var ip = req.socket.remoteAddress || "";
        var remaining = checkPinRateLimit(ip);
        if (remaining !== null) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
          return true;
        }
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
          try {
            var data = JSON.parse(body);
            if (data.step === "verify") {
              if (!data.password || data.password !== recovery.password) {
                recordPinFailure(ip);
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end('{"error":"Invalid recovery password"}');
                return;
              }
              clearPinFailures(ip);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } else if (data.step === "reset") {
              if (!data.password || data.password !== recovery.password) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end('{"error":"Invalid recovery password"}');
                return;
              }
              if (!data.pin || !/^\d{6}$/.test(data.pin)) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end('{"error":"PIN must be exactly 6 digits"}');
                return;
              }
              var admin = users.findAdmin();
              if (!admin) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end('{"error":"No admin account found"}');
                return;
              }
              users.updateUserPin(admin.id, data.pin);
              recovery = null;
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"Invalid step"}');
            }
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid request"}');
          }
        });
        return true;
      }
    }

    // Global auth endpoint (single-user PIN)
    if (req.method === "POST" && req.url === "/auth") {
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var pinOk = authToken && data.pin && verifyPin(data.pin, authToken);
          var totpOk = _totpSecret && data.totp && verifyTotp(data.totp, _totpSecret);
          // Evaluate based on authMode
          var authOk = false;
          var mode = getAuthMode();
          if (mode === "pin") authOk = pinOk;
          else if (mode === "totp") authOk = totpOk;
          else if (mode === "either") authOk = pinOk || totpOk;
          else if (mode === "both") authOk = pinOk && totpOk;
          else authOk = pinOk || totpOk; // fallback
          if (authOk) {
            clearPinFailures(ip);
            // Auto-upgrade legacy SHA256 hash to scrypt
            if (pinOk && authToken && authToken.indexOf(":") === -1) {
              var upgraded = generateAuthToken(data.pin);
              authToken = upgraded;
              if (typeof onUpgradePin === "function") {
                onUpgradePin(upgraded);
              }
            }
            // Use __totp_session__ cookie when TOTP-only (no PIN)
            var cookieValue = authToken;
            if (!authToken && _totpSecret) {
              cookieValue = "__totp_session__";
            }
            res.writeHead(200, {
              "Set-Cookie": "relay_auth=" + cookieValue + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : ""),
              "Content-Type": "application/json",
            });
            res.end('{"ok":true}');
          } else {
            recordPinFailure(ip);
            var attemptsLeft = PIN_MAX_ATTEMPTS - (pinAttempts[ip] ? pinAttempts[ip].count : 0);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, attemptsLeft: Math.max(attemptsLeft, 0) }));
          }
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return true;
    }

    // Admin setup (first-time multi-user setup)
    if (req.method === "POST" && fullUrl === "/auth/setup") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      if (users.hasAdmin()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Admin already exists"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!users.validateSetupCode(data.setupCode)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid setup code"}');
            return;
          }
          if (!data.username || data.username.trim().length < 1 || data.username.length > 100) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Username is required"}');
            return;
          }
          if (!data.pin || !/^\d{6}$/.test(data.pin)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"PIN must be exactly 6 digits"}');
            return;
          }
          // Migrate existing profile.json to admin profile
          var adminProfile = undefined;
          try {
            var existingProfile = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "profile.json"), "utf8"));
            adminProfile = {
              name: data.displayName || data.username,
              lang: existingProfile.lang || "en-US",
              avatarColor: existingProfile.avatarColor || "#7c3aed",
              avatarStyle: existingProfile.avatarStyle || "thumbs",
              avatarSeed: existingProfile.avatarSeed || crypto.randomBytes(4).toString("hex"),
            };
          } catch (e) {}
          var result = users.createAdmin({
            username: data.username.trim(),
            displayName: data.displayName || data.username.trim(),
            pin: data.pin,
            profile: adminProfile,
          });
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          // Auto-provision Linux account if OS users mode is enabled
          if (osUsers && !result.user.linuxUser) {
            var provision = provisionLinuxUser(result.user.username);
            if (provision.ok) {
              users.updateLinuxUser(result.user.id, provision.linuxUser);
              if (onUserProvisioned) onUserProvisioned(result.user.id, provision.linuxUser);
            }
          }
          users.clearSetupCode();
          var session = createMultiUserSession(result.user.id);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: result.user.id, username: result.user.username, role: result.user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Multi-user login
    if (req.method === "POST" && fullUrl === "/auth/login") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var user = users.authenticateUser(data.username, data.pin);
          if (!user) {
            recordPinFailure(ip);
            var attemptsLeft = PIN_MAX_ATTEMPTS - (pinAttempts[ip] ? pinAttempts[ip].count : 0);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid username or PIN", attemptsLeft: Math.max(attemptsLeft, 0) }));
            return;
          }
          clearPinFailures(ip);
          var session = createMultiUserSession(user.id);
          var loginResp = { ok: true, user: { id: user.id, username: user.username, role: user.role } };
          if (user.mustChangePin) loginResp.mustChangePin = true;
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(loginResp));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Request OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/request-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.email) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Email is required"}');
            return;
          }
          var user = users.findUserByEmail(data.email);
          if (!user) {
            // Don't reveal whether user exists
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            return;
          }
          var result = smtp.requestOtp(data.email);
          if (result.error) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          smtp.sendOtpEmail(data.email, result.code).then(function () {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          }).catch(function () {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end('{"error":"Failed to send email"}');
          });
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Verify OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/verify-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.email || !data.code) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Email and code are required"}');
            return;
          }
          var otpResult = smtp.verifyOtp(data.email, data.code);
          if (!otpResult.valid) {
            recordPinFailure(ip);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: otpResult.error, attemptsLeft: otpResult.attemptsLeft }));
            return;
          }
          var user = users.findUserByEmail(data.email);
          if (!user) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"ok":false,"error":"Account not found"}');
            return;
          }
          clearPinFailures(ip);
          var session = createMultiUserSession(user.id);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: user.id, username: user.username, role: user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Invite registration
    if (req.method === "POST" && fullUrl === "/auth/register") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var validation = users.validateInvite(data.inviteCode);
          if (!validation.valid) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: validation.error }));
            return;
          }
          if (!data.username || data.username.trim().length < 1 || data.username.length > 100) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Username is required"}');
            return;
          }
          var result;
          if (smtp.isEmailLoginEnabled() && !data.pin) {
            // SMTP mode: username + email required, no PIN
            if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"A valid email address is required"}');
              return;
            }
            result = users.createUserWithoutPin({
              username: data.username.trim(),
              email: data.email,
              displayName: data.displayName || data.username.trim(),
              role: "user",
            });
          } else {
            // PIN mode: username + PIN, no email required
            if (!data.pin || !/^\d{6}$/.test(data.pin)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"PIN must be exactly 6 digits"}');
              return;
            }
            result = users.createUser({
              username: data.username.trim(),
              email: data.email || null,
              displayName: data.displayName || data.username.trim(),
              pin: data.pin,
              role: "user",
            });
          }
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          // Auto-provision Linux account if OS users mode is enabled
          if (osUsers && !result.user.linuxUser) {
            var provision = provisionLinuxUser(result.user.username);
            if (provision.ok) {
              users.updateLinuxUser(result.user.id, provision.linuxUser);
              if (onUserProvisioned) onUserProvisioned(result.user.id, provision.linuxUser);
            }
          }
          users.markInviteUsed(data.inviteCode);
          var session = createMultiUserSession(result.user.id);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: result.user.id, username: result.user.username, role: result.user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Logout
    if (req.method === "POST" && fullUrl === "/auth/logout") {
      if (users.isMultiUser()) {
        var cookies = parseCookies(req);
        var token = cookies[MULTI_USER_COOKIE];
        if (token && multiUserTokens[token]) {
          delete multiUserTokens[token];
          saveTokens();
        }
        res.writeHead(200, {
          "Set-Cookie": MULTI_USER_COOKIE + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (tlsOptions ? "; Secure" : ""),
          "Content-Type": "application/json",
        });
      } else {
        res.writeHead(200, {
          "Set-Cookie": "relay_auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (tlsOptions ? "; Secure" : ""),
          "Content-Type": "application/json",
        });
      }
      res.end('{"ok":true}');
      return true;
    }

    // Invite page (magic link)
    if (req.method === "GET" && fullUrl.indexOf("/invite/") === 0) {
      var inviteCode = fullUrl.substring("/invite/".length);
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return true;
      }
      var validation = users.validateInvite(inviteCode);
      if (!validation.valid) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<!DOCTYPE html><html><head><title>Clay</title>' +
          '<style>body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
          '.c{text-align:center;max-width:360px;padding:20px}h1{color:#DA7756;margin-bottom:16px}p{color:#908B81}</style></head>' +
          '<body><div class="c"><h1>Clay</h1><p>' + (validation.error === "Invite expired" ? "This invite link has expired." : validation.error === "Invite already used" ? "This invite link has already been used." : "Invalid invite link.") + '</p></div></body></html>');
        return true;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(smtp.isEmailLoginEnabled() ? pages.smtpInvitePageHtml(inviteCode) : pages.invitePageHtml(inviteCode));
      return true;
    }

    return false;
  }

  return {
    handleRequest: handleRequest,
    getMultiUserFromReq: getMultiUserFromReq,
    isRequestAuthed: isRequestAuthed,
    parseCookies: parseCookies,
    revokeUserTokens: revokeUserTokens,
    setRecovery: setRecovery,
    clearRecovery: clearRecovery,
    setAuthToken: setAuthToken,
    getAuthPage: getAuthPage,
    createMultiUserSession: createMultiUserSession,
  };
}

module.exports = {
  attachAuth: attachAuth,
  generateAuthToken: generateAuthToken,
  verifyPin: verifyPin,
  verifyTotp: verifyTotp,
  verifyTotpCode: verifyTotpCode,
  loadTotpSecret: loadTotpSecret,
  generateTotpSecret: generateTotpSecret,
  saveTotpSecret: saveTotpSecret,
  getAuthMode: getAuthMode,
  saveAuthMode: saveAuthMode,
  isTotpAvailable: isTotpAvailable,
  loadAuthMode: loadAuthMode,
  getTotpSecret: function () { return _totpSecret; },
};
