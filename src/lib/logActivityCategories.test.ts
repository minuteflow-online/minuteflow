import { describe, it, expect } from "vitest";
import {
  categoryAfterProjectPick,
  categoryAfterTaskPick,
  isCategoryBlocked,
  isLogActivityCategoryDisabled,
  usableCategory,
} from "@/lib/logActivityCategories";

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

describe("fixed-rate (Output Based) tasks keep working", () => {
  it("blocks Task for an ordinary entry but not for a fixed-rate task", () => {
    expect(isCategoryBlocked("Task", false)).toBe(true);
    expect(isCategoryBlocked("Task", true)).toBe(false);
    expect(isCategoryBlocked("Communication", false)).toBe(false);
  });

  it("logs a fixed-rate task under Task, as before, when nothing else was chosen", () => {
    expect(categoryAfterTaskPick("", null, true)).toBe("Task");
  });

  it("lets the auto-category win for a fixed-rate task, including Task", () => {
    expect(categoryAfterTaskPick("", "Planning", true)).toBe("Planning");
    expect(categoryAfterTaskPick("", "Task", true)).toBe("Task");
  });

  it("keeps a category the VA already chose for a fixed-rate task", () => {
    expect(categoryAfterTaskPick("Collaboration", null, true)).toBe("Collaboration");
  });

  it("drops a Task suggestion for an ordinary task", () => {
    expect(categoryAfterTaskPick("", "Task", false)).toBe("");
    expect(categoryAfterTaskPick("Communication", "Task", false)).toBe("Communication");
  });

  it("clears a Task left over from a fixed-rate pick when an hourly task is picked", () => {
    expect(categoryAfterTaskPick("Task", null, false)).toBe("");
    expect(categoryAfterTaskPick("Task", "Planning", false)).toBe("Planning");
  });

  it("applies a project's auto-category the same way", () => {
    expect(categoryAfterProjectPick("", "Task", true)).toBe("Task");
    expect(categoryAfterProjectPick("", "Task", false)).toBe("");
    expect(categoryAfterProjectPick("Planning", null, false)).toBe("Planning");
  });
});
