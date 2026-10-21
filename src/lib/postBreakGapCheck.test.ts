import { describe, it, expect } from "vitest";
import { postBreakGapDecision } from "@/lib/postBreakGapCheck";

describe("postBreakGapDecision", () => {
  it("does nothing until a session has loaded", () => {
    expect(postBreakGapDecision(false, null)).toEqual({ markChecked: false, run: false });
  });

  it("runs once when the page loads clocked in with no running task (the case it exists for)", () => {
    expect(postBreakGapDecision(false, { clocked_in: true, active_task: null })).toEqual({ markChecked: true, run: true });
  });

  it("counts a page load that finds a running task as the one look, without running", () => {
    expect(postBreakGapDecision(false, { clocked_in: true, active_task: { logId: "5" } })).toEqual({ markChecked: true, run: false });
  });

  it("counts a page load while clocked out as the one look", () => {
    expect(postBreakGapDecision(false, { clocked_in: false, active_task: null })).toEqual({ markChecked: true, run: false });
  });

  it("never runs again after the first look, even when a task switch leaves no active task", () => {
    // The bug: load with a task running, then switch tasks.
    const first = postBreakGapDecision(false, { clocked_in: true, active_task: { logId: "5" } });
    expect(first.markChecked).toBe(true);
    // The flag is now set, and a session with no active task (mid-switch) arrives.
    expect(postBreakGapDecision(true, { clocked_in: true, active_task: null })).toEqual({ markChecked: false, run: false });
  });
});
