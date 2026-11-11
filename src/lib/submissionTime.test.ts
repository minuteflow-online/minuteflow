import { describe, expect, it } from "vitest";
import { allocateTaskTime, placeShotsByWork, roundDays, splitAcrossDays, workedSpanLabel } from "./submissionTime";

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
      roundDays({ id: 1, created_at: "2026-11-07T12:00:00Z" }, { totalMs: 1, byDay: { "2026-11-06": 1 }, sessions: [] }, TZ)
    ).toEqual(["2026-11-06"]);
  });

  it("falls back to the submission day when no time was logged", () => {
    expect(roundDays({ id: 1, created_at: "2026-11-07T12:00:00Z" }, { totalMs: 0, byDay: {}, sessions: [] }, TZ)).toEqual([
      "2026-11-07",
    ]);
  });
});

describe("round sessions and worked span", () => {
  // Nov 8, 11:30 PM ET for 1h, then Nov 9, 12:40 AM ET for 58m; submitted Nov 9, 1:55 AM ET.
  const t = allocateTaskTime(
    [{ id: 1, created_at: "2026-11-09T06:55:00Z" }],
    [
      { start_time: "2026-11-09T05:40:00Z", duration_ms: 58 * M },
      { start_time: "2026-11-09T04:30:00Z", duration_ms: 1 * H },
    ],
    TZ
  );

  it("keeps each logged stretch, earliest first", () => {
    expect(t.bySubmission[1].sessions).toEqual([
      { startMs: Date.parse("2026-11-09T04:30:00Z"), endMs: Date.parse("2026-11-09T05:30:00Z") },
      { startMs: Date.parse("2026-11-09T05:40:00Z"), endMs: Date.parse("2026-11-09T06:38:00Z") },
    ]);
  });

  it("labels the span from first start to last end, dating the end when it crosses midnight", () => {
    expect(workedSpanLabel(t.bySubmission[1].sessions, TZ)).toBe("Nov 8, 11:30 PM – Nov 9, 1:38 AM");
  });

  it("dates only the start when the work stayed on one day", () => {
    expect(
      workedSpanLabel([{ startMs: Date.parse("2026-11-05T14:00:00Z"), endMs: Date.parse("2026-11-05T16:00:00Z") }], TZ)
    ).toBe("Nov 5, 9:00 AM – 11:00 AM");
  });

  it("is null with nothing logged", () => {
    expect(workedSpanLabel([], TZ)).toBeNull();
  });
});

describe("splitAcrossDays", () => {
  it("splits a session at org-time midnight", () => {
    // Nov 8, 11:00 PM ET to Nov 9, 1:00 AM ET.
    expect(splitAcrossDays(Date.parse("2026-11-09T04:00:00Z"), 2 * H, TZ)).toEqual({
      "2026-11-08": 1 * H,
      "2026-11-09": 1 * H,
    });
  });

  it("keeps a same-day session whole", () => {
    expect(splitAcrossDays(Date.parse("2026-11-05T14:00:00Z"), 2 * H, TZ)).toEqual({ "2026-11-05": 2 * H });
  });

  it("splits correctly across a DST change", () => {
    // Nov 1, 2026 is the US fall-back day (25 hours long). 11 PM Oct 31 EDT -> 2h.
    expect(splitAcrossDays(Date.parse("2026-11-01T03:00:00Z"), 2 * H, TZ)).toEqual({
      "2026-10-31": 1 * H,
      "2026-11-01": 1 * H,
    });
  });
});

describe("allocateTaskTime across midnight", () => {
  it("puts each side of midnight on its own day, submitted or not", () => {
    const t = allocateTaskTime(
      [{ id: 1, created_at: "2026-11-09T07:00:00Z" }],
      [
        { start_time: "2026-11-09T04:00:00Z", duration_ms: 2 * H }, // 11 PM–1 AM, submitted
        { start_time: "2026-11-09T08:00:00Z", duration_ms: 30 * M }, // after the submission
      ],
      TZ
    );
    expect(t.bySubmission[1].byDay).toEqual({ "2026-11-08": 1 * H, "2026-11-09": 1 * H });
    expect(t.unsubmittedByDay).toEqual({ "2026-11-09": 30 * M });
  });
});

describe("placeShotsByWork", () => {
  // Charinade's case: captures from an Oct 29 log were linked to the Nov 9
  // resubmission. They belong to the Oct 31 submission, which reported that work.
  const subs = [
    { id: 10, created_at: "2026-10-31T12:31:00Z" },
    { id: 11, created_at: "2026-11-09T12:25:00Z" },
  ];
  const logStart = { 500: "2026-10-30T01:53:00Z" };

  it("moves a capture to the round that owns its time log", () => {
    const placed = placeShotsByWork([{ id: 1, submission_id: 11, log_id: 500 }], subs, logStart);
    expect(placed.get(10)?.map((s) => s.id)).toEqual([1]);
    expect(placed.get(11)).toBeUndefined();
  });

  it("keeps the linked submission when the log isn't known", () => {
    const placed = placeShotsByWork([{ id: 2, submission_id: 11, log_id: null }], subs, logStart);
    expect(placed.get(11)?.map((s) => s.id)).toEqual([2]);
  });
});
