const test = require("node:test");
const assert = require("node:assert/strict");
const { getCorrectSessionDate } = require("../src/sessionDate");

const TZ = "America/New_York";

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

test("no stored session_date -> today's date in the org timezone", () => {
  assert.equal(getCorrectSessionDate(null, TZ), todayStr());
  assert.equal(getCorrectSessionDate(undefined, TZ), todayStr());
  assert.equal(getCorrectSessionDate({}, TZ), todayStr());
});

test("stored session_date already matches today -> unchanged", () => {
  const today = todayStr();
  assert.equal(getCorrectSessionDate({ session_date: today }, TZ), today);
});

test("a long-stale session_date (missed Clock Out days ago) resets to today", () => {
  assert.equal(getCorrectSessionDate({ session_date: "2000-01-01" }, TZ), todayStr());
});
