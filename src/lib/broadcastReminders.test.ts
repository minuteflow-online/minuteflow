import { describe, expect, it } from "vitest";
import { reminderDue } from "./broadcastReminders";

describe("reminderDue", () => {
  it("waits 12 hours before the first reminder", () => {
    expect(reminderDue(0)).toBe(false);
    expect(reminderDue(11.9)).toBe(false);
    expect(reminderDue(12)).toBe(true);
    expect(reminderDue(12.9)).toBe(true);
    expect(reminderDue(13)).toBe(false);
  });

  it("then reminds once every 24 hours", () => {
    expect(reminderDue(35.9)).toBe(false);
    expect(reminderDue(36.2)).toBe(true);
    expect(reminderDue(37)).toBe(false);
    expect(reminderDue(60.5)).toBe(true);
  });

  it("lands in exactly one hourly run per cycle", () => {
    // Cron fires at the top of each hour; a broadcast published at :25 is checked at 0.583h, 1.583h, …
    const due = Array.from({ length: 72 }, (_, i) => i + 25 / 60).filter(reminderDue);
    expect(due.map((h) => Math.floor(h))).toEqual([12, 36, 60]);
  });
});
