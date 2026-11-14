import { describe, it, expect } from "vitest";
import { activityDayContext, belongsToToday, type ActivityDayLog } from "@/lib/activityLogDay";

const TZ = "America/New_York";

// EDT is UTC-4 on these dates, so 01:00 EDT is 05:00Z.
const at = (iso: string) => new Date(iso);

let nextId = 1;
const log = (over: Partial<ActivityDayLog> & { user_id: string }): ActivityDayLog => ({
  id: nextId++,
  category: "Task",
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

  it("keeps bridging later in the day too, since the entry never gets relabeled", () => {
    const logs = [
      log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null }),
    ];
    expect(todayIds(logs, at("2026-10-21T11:30:00.000Z"))).toEqual([0]); // 7:30 AM EDT
  });

  it("does not bridge an already-closed-out shift that merely shares yesterday's date with a later one that does", () => {
    const logs = [
      // Shift A: finished and clocked out well before midnight — a closed chapter.
      log({ user_id: "cha", category: "Task", start_time: "2026-10-20T11:00:00.000Z", end_time: "2026-10-20T12:00:00.000Z" }),
      log({ user_id: "cha", category: "Clock Out", start_time: "2026-10-20T12:00:00.000Z", end_time: "2026-10-20T12:00:00.000Z" }),
      // Shift B: a brand new Clock In later that evening, still filed under Oct 20, that does reach into Oct 21.
      log({ user_id: "cha", category: "Clock In", start_time: "2026-10-21T02:00:00.000Z", end_time: "2026-10-21T02:00:00.000Z" }),
      log({ user_id: "cha", category: "Task", start_time: "2026-10-21T03:50:00.000Z", end_time: null }),
    ];
    expect(todayIds(logs, at("2026-10-21T05:30:00.000Z"))).toEqual([2, 3]); // 1:30 AM EDT
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
      { id: nextId++, category: "Task", user_id: "x", session_date: null, start_time: "2026-10-21T15:00:00.000Z", end_time: null },
    ];
    expect(todayIds(logs, at("2026-10-21T18:00:00.000Z"))).toEqual([0]);
  });
});

describe("Activity Log 'today' at the exact boundaries", () => {
  it("bridges at the first minute after midnight Eastern (some engines report hour 24 then)", () => {
    const open = [log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null })];
    expect(todayIds(open, at("2026-10-21T04:00:00.000Z"))).toEqual([0]); // 12:00 AM EDT
    expect(todayIds(open, at("2026-10-21T04:00:30.000Z"))).toEqual([0]);
  });

  it("keeps bridging straight through what used to be the 6:00 AM cutoff", () => {
    const open = [log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null })];
    expect(todayIds(open, at("2026-10-21T09:59:00.000Z"))).toEqual([0]); // 5:59 AM EDT
    expect(todayIds(open, at("2026-10-21T10:00:00.000Z"))).toEqual([0]); // 6:00 AM EDT
  });

  it("does not bridge just before midnight, when yesterday is still today", () => {
    const open = [log({ user_id: "cha", start_time: "2026-10-21T03:31:00.000Z", end_time: null })];
    // 11:59 PM EDT on Oct 20: the entries are filed under Oct 20 = today, so they already show.
    expect(todayIds(open, at("2026-10-21T03:59:00.000Z"))).toEqual([0]);
  });

  it("works across the daylight-saving change (EST after Nov 1)", () => {
    const logs = [log({ user_id: "cha", session_date: "2026-11-01", start_time: "2026-11-02T04:31:00.000Z", end_time: null })];
    // 1:30 AM EST on Nov 2 = 06:30Z
    expect(todayIds(logs, at("2026-11-02T06:30:00.000Z"))).toEqual([0]);
  });
});
