var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var os = require("os");

// ============================================================
// TUI/GUI toggle persistence in single-user mode
//
// Tests the users-preferences.js logic that was fixed to support
// single-user deployments (where ws._clayUser is null and userId
// falls back to the "_default" sentinel).
// ============================================================

// Create a temporary users.json to isolate tests from real config
var tmpDir;
var usersFile;

function createTestPreferences(initialUsers) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-tui-test-"));
  usersFile = path.join(tmpDir, "users.json");
  var data = { multiUser: false, setupCode: null, users: initialUsers || [], invites: [], smtp: null };
  fs.writeFileSync(usersFile, JSON.stringify(data, null, 2));

  // Create a mock deps object that reads/writes our temp file
  var deps = {
    loadUsers: function () {
      try {
        return JSON.parse(fs.readFileSync(usersFile, "utf8"));
      } catch (e) {
        return { multiUser: false, setupCode: null, users: [], invites: [], smtp: null };
      }
    },
    saveUsers: function (d) {
      fs.writeFileSync(usersFile, JSON.stringify(d, null, 2));
    },
  };

  var { attachPreferences } = require("../lib/users-preferences");
  return attachPreferences(deps);
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true });
    tmpDir = null;
  }
}

// ============================================================
// 1. getClaudeOpenMode — default behavior
// ============================================================

test("getClaudeOpenMode returns 'gui' for unknown userId (pre-cutover)", function () {
  var prefs = createTestPreferences([]);
  // "_default" doesn't exist in users array yet
  var mode = prefs.getClaudeOpenMode("_default");
  // Before cutover (2026-06-14T10:00Z), default should be "gui"
  assert.strictEqual(mode, "gui", "Pre-cutover default should be gui");
  cleanup();
});

test("getClaudeOpenMode returns stored preference for existing user", function () {
  var prefs = createTestPreferences([
    { id: "user1", claudeOpenMode: "tui", claudeOpenModeSetAt: Date.now() },
  ]);
  assert.strictEqual(prefs.getClaudeOpenMode("user1"), "tui");
  cleanup();
});

test("getClaudeOpenMode returns fallback for user without stored preference", function () {
  var prefs = createTestPreferences([
    { id: "user1" },
  ]);
  var mode = prefs.getClaudeOpenMode("user1");
  assert.strictEqual(mode, "gui", "Should return pre-cutover default");
  cleanup();
});

// ============================================================
// 2. setClaudeOpenMode — single-user auto-create
// ============================================================

test("setClaudeOpenMode creates user record when not found", function () {
  var prefs = createTestPreferences([]);
  var result = prefs.setClaudeOpenMode("_default", "gui");
  assert.strictEqual(result.ok, true, "Should succeed");
  assert.strictEqual(result.claudeOpenMode, "gui");

  // Verify record was persisted
  var data = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  assert.strictEqual(data.users.length, 1, "Should have created one user record");
  assert.strictEqual(data.users[0].id, "_default");
  assert.strictEqual(data.users[0].claudeOpenMode, "gui");
  assert.ok(typeof data.users[0].claudeOpenModeSetAt === "number", "Should have setAt timestamp");
  cleanup();
});

test("setClaudeOpenMode updates existing user record", function () {
  var prefs = createTestPreferences([
    { id: "_default", claudeOpenMode: "tui", claudeOpenModeSetAt: Date.now() - 1000 },
  ]);
  var result = prefs.setClaudeOpenMode("_default", "gui");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.claudeOpenMode, "gui");

  // Verify persisted
  var mode = prefs.getClaudeOpenMode("_default");
  assert.strictEqual(mode, "gui");
  cleanup();
});

test("setClaudeOpenMode normalizes invalid mode to 'tui'", function () {
  var prefs = createTestPreferences([]);
  var result = prefs.setClaudeOpenMode("_default", "invalid");
  // Anything that isn't "gui" gets normalized to "tui"
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.claudeOpenMode, "tui");
  cleanup();
});

test("setClaudeOpenMode persists 'gui' then getClaudeOpenMode reads it back", function () {
  var prefs = createTestPreferences([]);
  prefs.setClaudeOpenMode("_default", "gui");
  var mode = prefs.getClaudeOpenMode("_default");
  assert.strictEqual(mode, "gui", "Set gui → get gui roundtrip should work");
  cleanup();
});

test("setClaudeOpenMode persists 'tui' then getClaudeOpenMode reads it back", function () {
  var prefs = createTestPreferences([]);
  prefs.setClaudeOpenMode("_default", "tui");
  var mode = prefs.getClaudeOpenMode("_default");
  assert.strictEqual(mode, "tui", "Set tui → get tui roundtrip should work");
  cleanup();
});

// ============================================================
// 3. Multiple users don't interfere
// ============================================================

test("different users have independent preferences", function () {
  var prefs = createTestPreferences([
    { id: "alice" },
    { id: "bob" },
  ]);
  prefs.setClaudeOpenMode("alice", "gui");
  prefs.setClaudeOpenMode("bob", "tui");

  assert.strictEqual(prefs.getClaudeOpenMode("alice"), "gui");
  assert.strictEqual(prefs.getClaudeOpenMode("bob"), "tui");
  cleanup();
});

// ============================================================
// 4. Edge cases
// ============================================================

test("setClaudeOpenMode with 'gui' explicit value", function () {
  var prefs = createTestPreferences([{ id: "u1" }]);
  var result = prefs.setClaudeOpenMode("u1", "gui");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.claudeOpenMode, "gui");
  cleanup();
});

test("repeated setClaudeOpenMode updates timestamp", function () {
  var prefs = createTestPreferences([]);
  prefs.setClaudeOpenMode("_default", "gui");
  var data1 = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  var ts1 = data1.users[0].claudeOpenModeSetAt;

  // Small delay to ensure different timestamp
  var start = Date.now();
  while (Date.now() === start) {} // spin until ms ticks

  prefs.setClaudeOpenMode("_default", "tui");
  var data2 = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  var ts2 = data2.users[0].claudeOpenModeSetAt;
  assert.ok(ts2 >= ts1, "Second set should have equal or later timestamp");
  cleanup();
});
