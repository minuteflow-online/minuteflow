import { describe, it, expect } from "vitest";
import { shouldAutoHold, holdNotice, autoHoldReason } from "@/lib/timeLogReview";
import type { ShiftAnomalyFinding } from "@/lib/shiftAnomalies";

// shouldAutoHold decides, with no human in the loop, whether somebody stops
// being paid for a stretch of their day. The cases that must NOT hold matter
// more than the ones that must.

function finding(over: Partial<ShiftAnomalyFinding> = {}): ShiftAnomalyFinding {
  return {
    type: "orphaned_clock_in",
    logId: 5929,
    logIds: [5929],
    taskName: "Clock In",
    startTime: "2026-08-29T00:00:00.000Z",
    endTime: "2026-08-29T03:18:00.000Z",
    windowStart: "2026-08-29T00:00:00.000Z",
    windowEnd: "2026-08-29T03:18:00.000Z",
    minutes: 198,
    detail: "Clock In placeholder ran 198 min without handing off to a task",
    ...over,
  };
}

describe("shouldAutoHold", () => {
  it("holds an unbacked Clock In", () => {
    // Flordeliz, 2026-08-28: 3h18m with a single screenshot, taken at the
    // instant she clocked in. Nothing accounts for the time after it.
    expect(shouldAutoHold(finding(), 1)).toBe(true);
    expect(shouldAutoHold(finding(), 0)).toBe(true);
  });

  it("does NOT hold a Clock In that screenshots back up", () => {
    // The July lesson: Arianne was closed as idle while uploading a screenshot
    // every five minutes. Evidence of work outranks a stale task label, and a
    // labelling problem is not a billing one.
    expect(shouldAutoHold(finding(), 2)).toBe(false);
    expect(shouldAutoHold(finding(), 40)).toBe(false);
  });

  it("never holds a billed break", () => {
    // A billable break is now a data problem. The fix is to unbill it, not to
    // take the time out of somebody's day.
    expect(shouldAutoHold(finding({ type: "billed_break" }), 0)).toBe(false);
  });

  it("never holds an overlap", () => {
    // Which of the two entries is wrong is a judgement, and guessing it would
    // unpay the wrong one.
    expect(shouldAutoHold(finding({ type: "overlap" }), 0)).toBe(false);
  });
});

describe("holdNotice", () => {
  const notice = holdNotice(finding(), 1);

  it("says what was set aside and for how long", () => {
    expect(notice).toContain("Clock In");
    expect(notice).toContain("3h 18m");
  });

  it("reports the screenshot evidence in their own terms", () => {
    expect(notice).toContain("only one screenshot");
    expect(holdNotice(finding(), 0)).toContain("were 0 screenshots");
  });

  it("carries no accusation", () => {
    // Toni's standing rule for anything sent to a VA. The system could not see
    // what the time was spent on; that is a statement about the system.
    expect(notice).toContain("not a mark against you");
    expect(notice).toMatch(/could not tell what the time was spent on/i);
    for (const word of ["suspicious", "violation", "failed", "wrong", "deleted"]) {
      expect(notice.toLowerCase(), word).not.toContain(word);
    }
  });

  it("tells them how to get it back, and that it comes back whole", () => {
    expect(notice).toContain("https://minuteflow.click/portal");
    expect(notice).toContain("goes back in full");
  });
});

describe("autoHoldReason", () => {
  it("explains itself in the room, without needing the alert", () => {
    const reason = autoHoldReason(finding(), 1);
    expect(reason).toContain("3h 18m");
    expect(reason).toContain("1 screenshot(s)");
    expect(reason).toContain("Set aside automatically");
  });
});
