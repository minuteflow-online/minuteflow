import { describe, it, expect } from "vitest";
import { fallsOn, occurrenceDates, taskRowFor, outputRowFor, type OccurrenceTemplate } from "@/lib/recurringOccurrences";

// A "Weekly" template used to be able to land on only one weekday — whichever
// one its start_date happened to fall on. A task that runs Mon/Wed/Fri (or
// Tue/Thu) had no way to be one template: the obvious workaround, one weekly
// template per weekday with the same name/detail/account, gets rejected by
// the templates API's own duplicate guard. recurrence_days lets one Weekly
// template carry several weekdays instead.
//
// recurrence_days is integer[] in Postgres, 0=Sun..6=Sat (same convention as
// profiles.work_days) — confirmed live when a day *name* ("Mon") was tried
// first and rejected at insert with "invalid input syntax for type integer".

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5;

const base: OccurrenceTemplate = {
  id: "t1",
  is_active: true,
  start_date: "2026-09-07", // a Monday
  recurrence_type: "weekly",
};

describe("fallsOn — weekly with recurrence_days", () => {
  it("lands only on the chosen weekdays, skipping weekends", () => {
    const mwf: OccurrenceTemplate = { ...base, recurrence_days: [MON, WED, FRI] };
    const results: Record<string, boolean> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 8, 7 + i)).toISOString().slice(0, 10);
      results[d] = fallsOn(mwf, d);
    }
    expect(results["2026-09-07"]).toBe(true); // Mon
    expect(results["2026-09-08"]).toBe(false); // Tue
    expect(results["2026-09-09"]).toBe(true); // Wed
    expect(results["2026-09-10"]).toBe(false); // Thu
    expect(results["2026-09-11"]).toBe(true); // Fri
    expect(results["2026-09-12"]).toBe(false); // Sat
    expect(results["2026-09-13"]).toBe(false); // Sun
    // Second week repeats the same pattern.
    expect(results["2026-09-14"]).toBe(true); // Mon
    expect(results["2026-09-16"]).toBe(true); // Wed
    expect(results["2026-09-18"]).toBe(true); // Fri
  });

  it("supports a second, independent set of days for a different task", () => {
    const tth: OccurrenceTemplate = { ...base, start_date: "2026-09-08", recurrence_days: [TUE, THU] };
    expect(fallsOn(tth, "2026-09-08")).toBe(true); // Tue
    expect(fallsOn(tth, "2026-09-09")).toBe(false); // Wed
    expect(fallsOn(tth, "2026-09-10")).toBe(true); // Thu
    expect(fallsOn(tth, "2026-09-15")).toBe(true); // Tue, next week
  });

  it("still respects start_date as a floor even on a chosen weekday", () => {
    const mwf: OccurrenceTemplate = { ...base, recurrence_days: [MON, WED, FRI] };
    // The Monday before start_date is a chosen weekday but earlier than the
    // template begins — must not land there.
    expect(fallsOn(mwf, "2026-08-31")).toBe(false);
  });

  it("still respects repeat_until as a ceiling", () => {
    const mwf: OccurrenceTemplate = { ...base, recurrence_days: [MON, WED, FRI], repeat_until: "2026-09-10" };
    expect(fallsOn(mwf, "2026-09-09")).toBe(true); // Wed, within range
    expect(fallsOn(mwf, "2026-09-11")).toBe(false); // Fri, past repeat_until
  });

  it("falls back to the legacy same-weekday behavior when no days are chosen", () => {
    // Nothing set — every 7 days from start_date, same as before this feature.
    expect(fallsOn(base, "2026-09-07")).toBe(true);
    expect(fallsOn(base, "2026-09-09")).toBe(false);
    expect(fallsOn(base, "2026-09-14")).toBe(true);

    const emptyDays: OccurrenceTemplate = { ...base, recurrence_days: [] };
    expect(fallsOn(emptyDays, "2026-09-09")).toBe(false);
  });

  it("treats all-garbage entries as no days chosen, falling back to legacy behavior, rather than throwing", () => {
    const garbage: OccurrenceTemplate = { ...base, recurrence_days: [7, -1, 3.5] };
    expect(() => fallsOn(garbage, "2026-09-09")).not.toThrow();
    // Same as the empty-array case above: no valid chosen day, so it's back to
    // "every 7 days from start_date" — Sept 9 isn't one of those.
    expect(fallsOn(garbage, "2026-09-09")).toBe(false);
  });
});

describe("occurrenceDates — weekly with recurrence_days", () => {
  it("produces exactly the Mon/Wed/Fri dates over a bounded window", () => {
    const mwf: OccurrenceTemplate = {
      ...base,
      recurrence_days: [MON, WED, FRI],
      repeat_until: "2026-09-20",
    };
    expect(occurrenceDates(mwf, "2026-09-07")).toEqual([
      "2026-09-07", "2026-09-09", "2026-09-11",
      "2026-09-14", "2026-09-16", "2026-09-18",
    ]);
  });
});

// The Work Span's End Date used to get stamped onto every single occurrence's
// own end_date (taskRowFor/outputRowFor), so a template with an End Date set
// produced occurrences that each rendered as a Calendar span from their own
// date all the way to that one fixed date — every occurrence overlapping
// every other one, and the count (and the hours shown) climbing every day
// another occurrence was added. Confirmed live: a Weekly Mon/Wed/Fri template
// with End Date 2026-10-07 showed 5 overlapping blocks on 2026-09-16, one for
// every MWF date generated up to and including it, all spanning to Oct 7.
//
// End Date is now a series ceiling, same role as Repeat Until, and no longer
// touches any individual occurrence's own end_date.
describe("end_date as a series ceiling", () => {
  it("stops generating occurrences after end_date, same as repeat_until", () => {
    const mwf: OccurrenceTemplate = { ...base, recurrence_days: [MON, WED, FRI], end_date: "2026-09-10" };
    expect(fallsOn(mwf, "2026-09-09")).toBe(true); // Wed, on or before end_date
    expect(fallsOn(mwf, "2026-09-11")).toBe(false); // Fri, past end_date
  });

  it("produces exactly the dates up to end_date, matching the repeat_until shape", () => {
    const mwf: OccurrenceTemplate = { ...base, recurrence_days: [MON, WED, FRI], end_date: "2026-09-16" };
    expect(occurrenceDates(mwf, "2026-09-07")).toEqual(["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14", "2026-09-16"]);
  });

  it("does not stamp the template's end_date onto a generated occurrence's own end_date", () => {
    const withEndDate = { ...base, recurrence_days: [MON, WED, FRI], end_date: "2026-10-07", start_time: "08:30" };
    const row = taskRowFor(withEndDate, "2026-09-07");
    expect(row.end_date).toBeNull();
    expect(row.start_date).toBe("2026-09-07"); // unaffected — only end_date changes
  });

  it("does the same for Output Based occurrences", () => {
    const withEndDate = { ...base, end_date: "2026-10-07" };
    const row = outputRowFor(withEndDate, "2026-09-07", "va-1");
    expect(row.end_date).toBeNull();
  });
});
