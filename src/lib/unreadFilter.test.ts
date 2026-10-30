import { describe, it, expect } from "vitest";
import { showsInUnreadFilter } from "./unreadFilter";

describe("showsInUnreadFilter", () => {
  it("shows a task that still has unread messages", () => {
    expect(showsInUnreadFilter(5, { 5: 2 }, new Set())).toBe(true);
  });

  it("hides a task with no unread messages", () => {
    expect(showsInUnreadFilter(5, { 6: 1 }, new Set())).toBe(false);
    expect(showsInUnreadFilter(5, { 5: 0 }, new Set())).toBe(false);
  });

  it("keeps a card that was just opened, even though its unread count is cleared", () => {
    expect(showsInUnreadFilter(5, {}, new Set([5]))).toBe(true);
  });

  it("does not keep a different card that was not opened", () => {
    expect(showsInUnreadFilter(7, {}, new Set([5]))).toBe(false);
  });

  it("hides rows with no task", () => {
    expect(showsInUnreadFilter(null, { 5: 1 }, new Set([5]))).toBe(false);
    expect(showsInUnreadFilter(undefined, {}, new Set())).toBe(false);
  });
});
