import { describe, it, expect } from "vitest";
import { cappedCloseTime } from "@/lib/cappedCloseTime";

const MANILA = "Asia/Manila"; // UTC+8
const EASTERN = "America/New_York"; // org timezone, UTC-4 in September (EDT)

describe("cappedCloseTime", () => {
  it("does not cap a log started and closing on the same org day", () => {
    const start = "2026-09-16T15:14:08.406Z"; // 11:14 AM ET
    const now = "2026-09-16T18:02:42.567Z"; // 2:02 PM ET, same ET calendar day
    const result = cappedCloseTime(start, now, EASTERN);
    expect(result.endTime).toBe(now);
    expect(result.durationMs).toBe(new Date(now).getTime() - new Date(start).getTime());
  });

  it("caps a genuinely overnight log at 23:59:59.999 of its own org-timezone day", () => {
    // Started 8pm ET on the 15th, "now" is well into the 16th ET.
    const start = "2026-09-16T00:00:00.000Z"; // 8:00 PM ET on the 15th
    const now = "2026-09-17T13:00:00.000Z"; // 9:00 AM ET on the 16th
    const result = cappedCloseTime(start, now, EASTERN);
    // End of Sep 15 in America/New_York, in UTC, is 2026-09-16T03:59:59.999Z.
    expect(result.endTime).toBe("2026-09-16T03:59:59.999Z");
  });

  // The actual bug: Charinade's task started well before midnight in her own
  // local timezone (Manila) but mid-afternoon in the org's timezone
  // (Eastern). Passing her browser's local zone here reproduces exactly
  // what went wrong on 2026-09-09 and 2026-09-16 — the task closes after
  // just seconds, with hours of real, screenshot-proven work discarded.
  it("does not truncate a mid-shift task just because the VA's local day rolled over", () => {
    // The actual 2026-09-09 incident: 15:59:38.722Z is 21ms... 21 SECONDS
    // before Manila midnight (23:59:38.722 PHT), but only 11:59 AM Eastern —
    // solidly mid-shift in the org's own timezone.
    const start = "2026-09-09T15:59:38.722Z";
    // A few minutes later — Manila has now crossed into the next calendar
    // day, but it's still the same Eastern-time business day.
    const now = "2026-09-09T16:05:00.000Z";

    // Passing the VA's own local zone reproduces the historical bug exactly:
    // capped at Manila end-of-day, ~21 seconds after start, discarding
    // everything real that happened afterward.
    const buggy = cappedCloseTime(start, now, MANILA);
    expect(buggy.endTime).toBe("2026-09-09T15:59:59.999Z");
    expect(buggy.durationMs).toBe(21277);

    // Passing the org's timezone (the actual fix) does not cap it at all —
    // same Eastern calendar day, so `now` is used as-is.
    const fixed = cappedCloseTime(start, now, EASTERN);
    expect(fixed.endTime).toBe(now);
    expect(fixed.durationMs).toBe(new Date(now).getTime() - new Date(start).getTime());
  });

  it("falls back to `now` when there is no start_time", () => {
    const now = "2026-09-16T18:02:42.567Z";
    const result = cappedCloseTime(null, now, EASTERN);
    expect(result.endTime).toBe(now);
    expect(result.durationMs).toBe(0);
  });
});
