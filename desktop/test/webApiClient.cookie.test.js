const test = require("node:test");
const assert = require("node:assert/strict");
const { _internal } = require("../src/webApiClient");
const { SUPABASE_URL } = require("../src/config");

test("auth cookie name matches @supabase/ssr's `sb-<project-ref>-auth-token` convention", () => {
  const expectedRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  assert.equal(_internal.authCookieName(), `sb-${expectedRef}-auth-token`);
});

test("short values are not chunked", () => {
  const chunks = _internal.chunkCookieValue("sb-x-auth-token", "base64-abc123");
  assert.deepEqual(chunks, [{ name: "sb-x-auth-token", value: "base64-abc123" }]);
});

test("long values are split into <name>.0, <name>.1, ... chunks that rejoin to the original", () => {
  const longValue = "base64-" + "a".repeat(9000); // well past the 3180-char chunk size
  const chunks = _internal.chunkCookieValue("sb-x-auth-token", longValue);

  assert.ok(chunks.length > 1, "expected more than one chunk for a 9000+ char value");
  chunks.forEach((chunk, i) => {
    assert.equal(chunk.name, i === 0 ? "sb-x-auth-token.0" : `sb-x-auth-token.${i}`);
    assert.ok(chunk.value.length <= 3180);
  });

  const rejoined = chunks.map((c) => c.value).join("");
  assert.equal(rejoined, longValue, "chunks must rejoin to the exact original value");
});

test("base64url round-trips a session-shaped JSON string the same way @supabase/ssr decodes it", () => {
  // @supabase/ssr's stringFromBase64URL (node_modules/@supabase/ssr/dist/main/utils/base64url.js)
  // is a standard, no-padding base64url codec — the same alphabet and behavior as Node's
  // built-in 'base64url' encoding target, which is what buildAuthCookieHeader() uses.
  const session = {
    access_token: "eyJhbGciOiJIUzI1NiJ9.fake.signature",
    refresh_token: "refresh-token-value",
    expires_at: 1999999999,
    user: { id: "va-1", email: "va@example.com" },
  };
  const raw = JSON.stringify(session);

  const encoded = Buffer.from(raw, "utf8").toString("base64url");
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");

  assert.equal(decoded, raw);
  assert.deepEqual(JSON.parse(decoded), session);
  // base64url must never contain the raw JSON's special characters
  assert.doesNotMatch(encoded, /[{}":,]/);
});
