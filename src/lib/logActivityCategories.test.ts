import { describe, it, expect } from "vitest";
import { isLogActivityCategoryDisabled, usableCategory } from "@/lib/logActivityCategories";

describe("isLogActivityCategoryDisabled", () => {
  it("disables Task", () => {
    expect(isLogActivityCategoryDisabled("Task")).toBe(true);
  });

  it("leaves every other category usable", () => {
    for (const c of ["Communication", "Planning", "Collaboration", "Personal", "Break"]) {
      expect(isLogActivityCategoryDisabled(c)).toBe(false);
    }
  });
});

describe("usableCategory", () => {
  it("applies a suggestion for a usable category", () => {
    expect(usableCategory("Planning", "")).toBe("Planning");
    expect(usableCategory("Collaboration", "Communication")).toBe("Collaboration");
  });

  it("drops a suggestion for Task and keeps what is selected", () => {
    // e.g. the auto-category for Operations & Admin Work, or a prefill carrying Task
    expect(usableCategory("Task", "")).toBe("");
    expect(usableCategory("Task", "Communication")).toBe("Communication");
  });

  it("keeps what is selected when there is no suggestion", () => {
    expect(usableCategory(null, "Break")).toBe("Break");
    expect(usableCategory(undefined, "")).toBe("");
  });
});
