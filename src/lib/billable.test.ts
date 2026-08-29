import { describe, it, expect } from "vitest";
import { isBillableCategory } from "@/lib/billable";

// This rule used to be written out by hand at nine call sites, four of which
// excluded Personal but not Break — which is how thousands of minutes of break
// time got billed as work. These cases exist so the rule stays one rule.

describe("isBillableCategory", () => {
  it("does not pay break time", () => {
    expect(isBillableCategory("Break")).toBe(false);
  });

  it("does not pay personal time", () => {
    expect(isBillableCategory("Personal")).toBe(false);
  });

  it("pays real work", () => {
    for (const category of ["Task", "Message", "Meeting", "Sorting Tasks", "Collaboration"]) {
      expect(isBillableCategory(category), category).toBe(true);
    }
  });

  it("ignores stray whitespace, since these arrive from form fields", () => {
    expect(isBillableCategory(" Break ")).toBe(false);
    expect(isBillableCategory("Personal ")).toBe(false);
  });

  it("treats a missing category as billable, matching the old behaviour", () => {
    // An uncategorised entry is a data problem, not unpaid time. Defaulting it
    // to unpaid would quietly stop paying someone for real work.
    expect(isBillableCategory(null)).toBe(true);
    expect(isBillableCategory(undefined)).toBe(true);
    expect(isBillableCategory("")).toBe(true);
  });

  it("is case sensitive, matching the values the app writes", () => {
    // The app writes exactly "Break"/"Personal". Loosening this would start
    // silently unpaying categories that merely look similar.
    expect(isBillableCategory("break")).toBe(true);
  });
});
