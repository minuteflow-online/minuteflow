import { describe, it, expect } from "vitest";
import { cappedCloseTime, STALE_OPEN_MS } from "@/lib/cappedCloseTime";

const MANILA = "Asia/Manila"; // UTC+8
const EASTERN = "America/New_York"; // org timezone, UTC-4 in September (EDT)

const HOUR = 60 * 60 * 1000;

describe("cappedCloseTime", () => {
  it("does not cap a log started and closing on the same org day", () => {
    const start = "2026-09-16T15:14:08.406Z"; // 11:14 AM ET
    const now = "2026-09-16T18:02:42.567Z"; // 2:02 PM ET, same ET calendar day
    const result = cappedCloseTime(start, now, EASTERN);
    expect(result.endTime).toBe(now);
    expect(result.durationMs).toBe(new Date(now).getTime() - new Date(start).getTime());
  });

  it("falls back to `now` when there is no start_time", () => {
    const now = "2026-09-16T18:02:42.567Z";
    const result = cappedCloseTime(null, now, EASTERN);
    expect(result.endTime).toBe(now);
    expect(result.durationMs).toBe(0);
  });

  describe("a log that crossed org midnight but is only hours old is being worked, not abandoned", () => {
    // Shem, 2026-09-18: "WebUpdate Planning" started 11:41 PM ET on the 17th,
    // switched to the next task at 1:45 AM ET on the 18th. Seven screenshots
    // kept arriving for it the whole time. It was capped at 11:59:59.999 PM
    // and 1h45m44s of real work was lost.
    it("keeps Shem's 11:41 PM -> 1:45 AM task whole", () => {
      const start = "2026-09-18T03:41:39.053Z"; // 11:41 PM ET on the 17th
      const now = "2026-09-18T05:45:44.327Z"; // 1:45 AM ET on the 18th
      const result = cappedCloseTime(start, now, EASTERN);
      expect(result.endTime).toBe(now);
      expect(result.durationMs).toBe(new Date(now).getTime() - new Date(start).getTime());
    });

    // Shem, 2026-09-19: "Clock In" at 11:59 PM ET, first real task started at
    // 12:35 AM. Capped at 11:59:59.999 PM, 35 minutes lost.
    it("keeps Shem's 11:59 PM Clock In through to 12:35 AM", () => {
      const start = "2026-09-19T03:59:11.778Z";
      const now = "2026-09-19T04:35:15.233Z";
      const result = cappedCloseTime(start, now, EASTERN);
      expect(result.endTime).toBe(now);
      expect(result.durationMs).toBe(2_163_455);
    });

    // Charinade, 2026-09-09: 21 seconds before Manila midnight, mid-shift in
    // Eastern time. The old code read the browser's zone and capped it. It is
    // safe on both counts now: read in the org zone it is the same day, and
    // even a wrong zone can't cap a log that has only been open minutes.
    it("keeps Charinade's task whole whichever timezone is used to read the day", () => {
      const start = "2026-09-09T15:59:38.722Z";
      const now = "2026-09-09T16:05:00.000Z";
      for (const tz of [EASTERN, MANILA]) {
        const result = cappedCloseTime(start, now, tz);
        expect(result.endTime).toBe(now);
      }
    });
  });

  describe("a log that crossed org midnight and has been open past the threshold is abandoned", () => {
    it("caps it at 23:59:59.999 of the org day it started on", () => {
      // "Clock In" left running from 8 PM ET on the 15th until 9 AM ET on the 16th.
      const start = "2026-09-16T00:00:00.000Z";
      const now = "2026-09-16T13:00:00.000Z";
      const result = cappedCloseTime(start, now, EASTERN);
      // End of Sep 15 in America/New_York, in UTC.
      expect(result.endTime).toBe("2026-09-16T03:59:59.999Z");
      expect(result.durationMs).toBe(new Date("2026-09-16T03:59:59.999Z").getTime() - new Date(start).getTime());
    });

    it("uses the boundary between real work and abandonment", () => {
      // Started 11 PM ET on the 15th; midnight is crossed either way.
      const start = "2026-09-16T03:00:00.000Z";
      const startMs = new Date(start).getTime();

      const justUnder = new Date(startMs + STALE_OPEN_MS - 1000).toISOString();
      expect(cappedCloseTime(start, justUnder, EASTERN).endTime).toBe(justUnder);

      const justOver = new Date(startMs + STALE_OPEN_MS + 1000).toISOString();
      expect(cappedCloseTime(start, justOver, EASTERN).endTime).toBe("2026-09-16T03:59:59.999Z");
    });

    it("does not treat a long log as abandoned when it never crossed midnight", () => {
      // Nine hours, all within one org day: nobody caps a same-day log.
      const start = "2026-09-16T10:00:00.000Z"; // 6 AM ET
      const now = new Date(new Date(start).getTime() + 9 * HOUR).toISOString(); // 3 PM ET
      expect(cappedCloseTime(start, now, EASTERN).endTime).toBe(now);
    });
  });
});
