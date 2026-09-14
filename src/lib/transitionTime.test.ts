import { describe, expect, it } from "vitest";
import { computeTransitionMs } from "./transitionTime";

const U = "va-1";

function log(start: string, end: string, extra: Partial<Parameters<typeof computeTransitionMs>[0][number]> = {}) {
  return { user_id: U, session_date: "2026-09-14", start_time: start, end_time: end, ...extra };
}

describe("computeTransitionMs", () => {
  it("counts the gap between finishing one entry and starting the next", () => {
    const ms = computeTransitionMs([
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z"),
      log("2026-09-14T14:15:00Z", "2026-09-14T15:00:00Z"),
    ]);
    expect(ms).toBe(15 * 60_000);
  });

  it("subtracts the wizard time, which is already reported on its own", () => {
    const ms = computeTransitionMs([
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z", { form_fill_ms: 5 * 60_000 }),
      log("2026-09-14T14:15:00Z", "2026-09-14T15:00:00Z"),
    ]);
    // 15 minutes of gap, 5 of which was the wizard being filled in.
    expect(ms).toBe(10 * 60_000);
  });

  it("never counts an overnight boundary as a gap", () => {
    const ms = computeTransitionMs([
      { user_id: U, session_date: "2026-09-14", start_time: "2026-09-14T13:00:00Z", end_time: "2026-09-14T21:00:00Z" },
      { user_id: U, session_date: "2026-09-15", start_time: "2026-09-15T13:00:00Z", end_time: "2026-09-15T14:00:00Z" },
    ]);
    expect(ms).toBe(0);
  });

  it("skips a gap that contains a Clock Out — that is going home, not stalling", () => {
    const logs = [
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z"),
      log("2026-09-14T18:00:00Z", "2026-09-14T19:00:00Z"),
      { user_id: U, session_date: "2026-09-14", start_time: "2026-09-14T14:30:00Z", end_time: "2026-09-14T14:30:00Z", category: "Clock Out" },
    ];
    expect(computeTransitionMs(logs)).toBe(0);
  });

  it("takes clock-out markers from a separate list when the caller filtered them out", () => {
    const filtered = [
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z"),
      log("2026-09-14T18:00:00Z", "2026-09-14T19:00:00Z"),
    ];
    const markers = [
      { user_id: U, start_time: "2026-09-14T14:30:00Z", category: "Clock Out" },
    ];
    expect(computeTransitionMs(filtered, markers)).toBe(0);
    // Without the markers the same pair reads as four hours of dead time.
    expect(computeTransitionMs(filtered, [])).toBe(4 * 3_600_000);
  });

  it("ignores overlapping or back-to-back entries", () => {
    const ms = computeTransitionMs([
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z"),
      log("2026-09-14T14:00:00Z", "2026-09-14T15:00:00Z"), // back to back
      log("2026-09-14T14:30:00Z", "2026-09-14T16:00:00Z"), // overlaps the one before
    ]);
    expect(ms).toBe(0);
  });

  it("keeps two people's days apart", () => {
    const ms = computeTransitionMs([
      { user_id: "a", session_date: "2026-09-14", start_time: "2026-09-14T13:00:00Z", end_time: "2026-09-14T14:00:00Z" },
      { user_id: "b", session_date: "2026-09-14", start_time: "2026-09-14T16:00:00Z", end_time: "2026-09-14T17:00:00Z" },
    ]);
    expect(ms).toBe(0);
  });

  it("ignores an entry that is still running", () => {
    const ms = computeTransitionMs([
      log("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z"),
      { user_id: U, session_date: "2026-09-14", start_time: "2026-09-14T14:30:00Z", end_time: null },
    ]);
    // The open entry can't close a gap, so there is no completed pair to measure.
    expect(ms).toBe(0);
  });
});
