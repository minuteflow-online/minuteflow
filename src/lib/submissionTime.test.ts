import { describe, expect, it } from "vitest";
import { allocateTaskTime, roundDays } from "./submissionTime";

const TZ = "America/New_York";
const H = 3_600_000;
const M = 60_000;

describe("allocateTaskTime", () => {
  // Nov 5: 2h, submitted that evening. Nov 6: 3h, submitted the next morning
  // (Nov 7). Then 30m started after the last submission.
  const subs = [
    { id: 1, created_at: "2026-11-05T22:00:00Z" }, // Nov 5, 5pm ET
    { id: 2, created_at: "2026-11-07T12:00:00Z" }, // Nov 7, 7am ET
  ];
  const logs = [
    { start_time: "2026-11-05T14:00:00Z", duration_ms: 2 * H }, // Nov 5
    { start_time: "2026-11-06T14:00:00Z", duration_ms: 2 * H }, // Nov 6
    { start_time: "2026-11-06T18:00:00Z", duration_ms: 1 * H }, // Nov 6
    { start_time: "2026-11-07T15:00:00Z", duration_ms: 30 * M }, // after the last submission
  ];
  const t = allocateTaskTime(subs, logs, TZ);

  it("gives each submission the work since the previous one", () => {
    expect(t.bySubmission[1].totalMs).toBe(2 * H);
    expect(t.bySubmission[2].totalMs).toBe(3 * H);
  });

  it("splits a round's time by the day the work was logged, not the day it was submitted", () => {
    expect(t.bySubmission[1].byDay).toEqual({ "2026-11-05": 2 * H });
    // Submitted Nov 7, but the work was on Nov 6.
    expect(t.bySubmission[2].byDay).toEqual({ "2026-11-06": 3 * H });
  });

  it("keeps time after the latest submission as unsubmitted, and counts it in the total", () => {
    expect(t.unsubmittedMs).toBe(30 * M);
    expect(t.totalMs).toBe(5 * H + 30 * M);
  });

  it("gives a duplicate re-send minutes later no time of its own", () => {
    const dup = allocateTaskTime(
      [...subs, { id: 3, created_at: "2026-11-07T12:04:00Z" }],
      logs.slice(0, 3),
      TZ
    );
    expect(dup.bySubmission[3].totalMs).toBe(0);
    expect(dup.bySubmission[2].totalMs).toBe(3 * H);
  });

  it("splits a round that spans two days across both", () => {
    const span = allocateTaskTime(
      [{ id: 9, created_at: "2026-11-06T23:00:00Z" }],
      logs.slice(0, 3),
      TZ
    );
    expect(span.bySubmission[9].byDay).toEqual({ "2026-11-05": 2 * H, "2026-11-06": 3 * H });
  });

  it("ignores logs with no start or no duration", () => {
    const none = allocateTaskTime(subs, [
      { start_time: null, duration_ms: H },
      { start_time: "2026-11-05T14:00:00Z", duration_ms: null },
    ], TZ);
    expect(none.totalMs).toBe(0);
  });
});

describe("roundDays", () => {
  it("is the days the work was logged on", () => {
    expect(
      roundDays({ id: 1, created_at: "2026-11-07T12:00:00Z" }, { totalMs: 1, byDay: { "2026-11-06": 1 } }, TZ)
    ).toEqual(["2026-11-06"]);
  });

  it("falls back to the submission day when no time was logged", () => {
    expect(roundDays({ id: 1, created_at: "2026-11-07T12:00:00Z" }, { totalMs: 0, byDay: {} }, TZ)).toEqual([
      "2026-11-07",
    ]);
  });
});
