var test = require("node:test");
var assert = require("node:assert");
var crypto = require("crypto");

// Import TOTP functions directly (they are pure functions, no side effects)
var {
  verifyTotp,
  generateTotpSecret,
  getAuthMode,
  saveAuthMode,
  loadAuthMode,
} = require("../lib/server-auth");

// ============================================================
// 1. Base32 encoding/decoding (via generateTotpSecret output)
// ============================================================

test("generateTotpSecret returns valid base32 string", function () {
  var secret = generateTotpSecret();
  assert.ok(secret.length > 0, "Secret should not be empty");
  // Base32 uses only A-Z and 2-7
  assert.ok(/^[A-Z2-7]+$/.test(secret), "Secret should be valid base32: " + secret);
  // 20 bytes = 160 bits, base32 encodes 5 bits per char → 32 chars
  assert.strictEqual(secret.length, 32, "160-bit secret should be 32 base32 chars");
});

test("generateTotpSecret produces unique secrets", function () {
  var s1 = generateTotpSecret();
  var s2 = generateTotpSecret();
  assert.notStrictEqual(s1, s2, "Each call should produce a different secret");
});

// ============================================================
// 2. TOTP code generation and verification (RFC 6238)
// ============================================================

test("verifyTotp accepts valid code for current time window", function () {
  var secret = generateTotpSecret();
  // Generate code for current time step using same algorithm
  var timeStep = Math.floor(Date.now() / 30000);
  var code = generateCodeForStep(secret, timeStep);
  assert.strictEqual(verifyTotp(code, secret), true, "Current time step code should verify");
});

test("verifyTotp accepts code from adjacent time windows (clock skew)", function () {
  var secret = generateTotpSecret();
  var timeStep = Math.floor(Date.now() / 30000);
  // Code from previous window should also verify (skew tolerance)
  var codePrev = generateCodeForStep(secret, timeStep - 1);
  assert.strictEqual(verifyTotp(codePrev, secret), true, "Previous window code should verify");
  // Code from next window
  var codeNext = generateCodeForStep(secret, timeStep + 1);
  assert.strictEqual(verifyTotp(codeNext, secret), true, "Next window code should verify");
});

test("verifyTotp rejects code from distant time window", function () {
  var secret = generateTotpSecret();
  var timeStep = Math.floor(Date.now() / 30000);
  // 5 steps away should not verify
  var codeFar = generateCodeForStep(secret, timeStep + 5);
  assert.strictEqual(verifyTotp(codeFar, secret), false, "Distant time step should not verify");
});

test("verifyTotp rejects wrong code", function () {
  var secret = generateTotpSecret();
  assert.strictEqual(verifyTotp("000000", secret), false, "Random code should not verify (usually)");
  assert.strictEqual(verifyTotp("123456", secret), false, "Arbitrary code should not verify (usually)");
});

test("verifyTotp rejects invalid inputs", function () {
  var secret = generateTotpSecret();
  assert.strictEqual(verifyTotp("", secret), false, "Empty code should not verify");
  assert.strictEqual(verifyTotp(null, secret), false, "Null code should not verify");
  assert.strictEqual(verifyTotp("12345", secret), false, "5-digit code should not verify");
  assert.strictEqual(verifyTotp("1234567", secret), false, "7-digit code should not verify");
  assert.strictEqual(verifyTotp("abcdef", secret), false, "Non-numeric code should not verify");
  assert.strictEqual(verifyTotp("123456", ""), false, "Empty secret should not verify");
  assert.strictEqual(verifyTotp("123456", null), false, "Null secret should not verify");
});

test("verifyTotp handles whitespace in code", function () {
  var secret = generateTotpSecret();
  var timeStep = Math.floor(Date.now() / 30000);
  var code = generateCodeForStep(secret, timeStep);
  // Codes with spaces (common from authenticator apps showing "123 456")
  var spaced = code.slice(0, 3) + " " + code.slice(3);
  assert.strictEqual(verifyTotp(spaced, secret), true, "Code with space should verify after stripping");
});

// ============================================================
// 3. Auth mode validation
// ============================================================

test("saveAuthMode accepts valid modes", function () {
  assert.strictEqual(saveAuthMode("pin"), true);
  assert.strictEqual(saveAuthMode("totp"), true);
  assert.strictEqual(saveAuthMode("either"), true);
  assert.strictEqual(saveAuthMode("both"), true);
});

test("saveAuthMode rejects invalid modes", function () {
  assert.strictEqual(saveAuthMode("invalid"), false);
  assert.strictEqual(saveAuthMode(""), false);
  assert.strictEqual(saveAuthMode("PIN"), false, "Mode should be case-sensitive");
  assert.strictEqual(saveAuthMode("none"), false);
});

test("getAuthMode returns current mode after save", function () {
  saveAuthMode("either");
  assert.strictEqual(getAuthMode(), "either");
  saveAuthMode("pin");
  assert.strictEqual(getAuthMode(), "pin");
});

// ============================================================
// Helper: generate TOTP code (mirrors server-auth.js logic)
// ============================================================

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

function generateCodeForStep(secret, timeStep) {
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
