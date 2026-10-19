import { describe, it, expect } from "vitest";
import { fixedTaskBelongsTo } from "@/lib/fixedPayCalendar";

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
