import { describe, it, expect } from "vitest";
import { fixedTaskBelongsTo, outputTasksForDay } from "@/lib/fixedPayCalendar";

describe("fixedTaskBelongsTo", () => {
  it("includes a task claimed by the person", () => {
    expect(fixedTaskBelongsTo({ claimed_by: "va-1", assigned_to: null }, "va-1")).toBe(true);
  });

  it("includes an unclaimed task assigned to the person (an admin created it for them)", () => {
    expect(fixedTaskBelongsTo({ claimed_by: null, assigned_to: "va-1" }, "va-1")).toBe(true);
  });

  it("leaves out a task someone else claimed, even if it was assigned to this person", () => {
    expect(fixedTaskBelongsTo({ claimed_by: "va-2", assigned_to: "va-1" }, "va-1")).toBe(false);
  });

  it("leaves out an unclaimed task assigned to someone else, and the open pool", () => {
    expect(fixedTaskBelongsTo({ claimed_by: null, assigned_to: "va-2" }, "va-1")).toBe(false);
    expect(fixedTaskBelongsTo({ claimed_by: null, assigned_to: null }, "va-1")).toBe(false);
  });
});

describe("outputTasksForDay", () => {
  const item = (over: Partial<Parameters<typeof outputTasksForDay>[0][number]> = {}) => ({
    taskId: 1,
    source: "fixed" as const,
    title: "SMC_Revision",
    date: "2026-09-25",
    dateType: "start" as const,
    startDate: "2026-09-25",
    ...over,
  });

  it("lists a task on its start day as Starts", () => {
    expect(outputTasksForDay([item()]).map((e) => e.label)).toEqual(["Starts"]);
  });

  it("lists a task on its due day as Due", () => {
    expect(outputTasksForDay([item({ date: "2026-10-15", dateType: "due" })]).map((e) => e.label)).toEqual(["Due"]);
  });

  it("leaves out the days in between a multi-day span", () => {
    expect(outputTasksForDay([item({ date: "2026-09-26" })])).toEqual([]);
  });

  it("lists a task once, as Due, when it starts and is due the same day", () => {
    const entries = outputTasksForDay([item(), item({ dateType: "due" })]);
    expect(entries.map((e) => e.label)).toEqual(["Due"]);
  });

  it("ignores time-based tasks", () => {
    expect(outputTasksForDay([item({ source: "assigned" })])).toEqual([]);
  });
});
