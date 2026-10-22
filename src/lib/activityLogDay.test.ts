import { describe, it, expect } from "vitest";
import { activityDayContext, belongsToToday, type ActivityDayLog } from "@/lib/activityLogDay";

const TZ = "America/New_York";

// EDT is UTC-4 on these dates, so 01:00 EDT is 05:00Z.
const at = (iso: string) => new Date(iso);

const log = (over: Partial<ActivityDayLog> & { user_id: string }): ActivityDayLog => ({
  session_date: "2026-10-20",
  start_time: "2026-10-20T15:00:00.000Z",
  end_time: "2026-10-20T16:00:00.000Z",
  ...over,
});

function todayIds(logs: ActivityDayLog[], now: Date) {
  const ctx = activityDayContext(logs, now, TZ);
  return logs.map((l, i) => (belongsToToday(l, TZ, ctx) ? i : -1)).filter((i) => i >= 0);
}

describe("Activity Log 'today' across the overnight cutoff", () => {
  it("keeps a person's ongoing shift in Today after midnight (Charinade, Oct 21)", () => {
    const logs = [
      // Clock In 11:26 PM Oct 20, closed
      log({ user_id: "cha", start_time: "2026-10-21T03:26:00.000Z", end_time: "2026-10-21T03:31:00.000Z" }),
      // ECC_Processing from 11:31 PM, still open, filed under Oct 20 by the overnight rule
      log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null }),
    ];
    expect(todayIds(logs, at("2026-10-21T05:30:00.000Z"))).toEqual([0, 1]); // 1:30 AM EDT
  });

  it("keeps the whole earlier part of that shift together with the new entries", () => {
    const logs = [
      log({ user_id: "cha", start_time: "2026-10-21T00:59:00.000Z", end_time: "2026-10-21T03:26:00.000Z" }), // 8:59-11:26 PM
      log({ user_id: "cha", start_time: "2026-10-21T04:08:00.000Z", end_time: "2026-10-21T05:50:00.000Z" }), // 12:08-1:50 AM, filed Oct 20, crossed midnight
    ];
    expect(todayIds(logs, at("2026-10-21T05:55:00.000Z"))).toEqual([0, 1]);
  });

  it("leaves someone who finished before midnight in previous days", () => {
    const logs = [
      log({ user_id: "neil", start_time: "2026-10-20T15:00:00.000Z", end_time: "2026-10-21T02:00:00.000Z" }), // ended 10 PM Oct 20
    ];
    expect(todayIds(logs, at("2026-10-21T05:30:00.000Z"))).toEqual([]);
  });

  it("does not let one person's overnight shift pull in someone else's day", () => {
    const logs = [
      log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null }),
      log({ user_id: "neil", start_time: "2026-10-20T15:00:00.000Z", end_time: "2026-10-20T20:00:00.000Z" }),
    ];
    expect(todayIds(logs, at("2026-10-21T05:30:00.000Z"))).toEqual([0]);
  });

  it("always shows entries filed under today", () => {
    const logs = [
      log({ user_id: "ari", session_date: "2026-10-21", start_time: "2026-10-21T04:30:00.000Z", end_time: null }),
    ];
    expect(todayIds(logs, at("2026-10-21T05:30:00.000Z"))).toEqual([0]);
  });

  it("applies no bridge after the cutoff, when new entries are filed under today again", () => {
    const logs = [
      log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null }),
    ];
    expect(todayIds(logs, at("2026-10-21T11:30:00.000Z"))).toEqual([]); // 7:30 AM EDT
  });

  it("uses the same rule as before in the middle of the day", () => {
    const logs = [
      log({ user_id: "neil", session_date: "2026-10-21", start_time: "2026-10-21T15:00:00.000Z", end_time: null }),
      log({ user_id: "neil", session_date: "2026-10-20" }),
    ];
    expect(todayIds(logs, at("2026-10-21T18:00:00.000Z"))).toEqual([0]); // 2 PM EDT
  });

  it("falls back to the start time's date when a log has no session_date", () => {
    const logs = [
      { user_id: "x", session_date: null, start_time: "2026-10-21T15:00:00.000Z", end_time: null },
    ];
    expect(todayIds(logs, at("2026-10-21T18:00:00.000Z"))).toEqual([0]);
  });
});
