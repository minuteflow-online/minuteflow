import { describe, it, expect } from "vitest";
import { isBreakLike } from "@/lib/awayCategories";

describe("isBreakLike", () => {
  it("is true for Break and Pause", () => {
    expect(isBreakLike("Break")).toBe(true);
    expect(isBreakLike("Pause")).toBe(true);
  });

  it("is false for every other category, exactly as the Break-only check was", () => {
    for (const c of [
      "Task", "Message", "Meeting", "Sorting Tasks", "Sorting", "Planning", "Collaboration",
      "Communication", "Personal", "Clock In", "Clock Out", "Wizard Time",
    ]) {
      expect(isBreakLike(c), c).toBe(false);
    }
  });

  it("is false for empty values and different casing, like the old exact comparison", () => {
    expect(isBreakLike(null)).toBe(false);
    expect(isBreakLike(undefined)).toBe(false);
    expect(isBreakLike("")).toBe(false);
    expect(isBreakLike("break")).toBe(false);
    expect(isBreakLike("pause")).toBe(false);
  });
});
