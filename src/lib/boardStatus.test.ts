import { describe, expect, it } from "vitest";
import { boardStatus, columnForStatus } from "./subtaskStatusColumns";

describe("boardStatus", () => {
  it("shows a single assignee's status over a stale task status", () => {
    expect(boardStatus("submitted", [{ status: "approved" }])).toBe("approved");
    expect(boardStatus("pending", [{ status: "submitted" }])).toBe("submitted");
    expect(boardStatus("approved", [{ status: "completed" }])).toBe("completed");
  });

  it("puts a task with a revision request under revision_needed", () => {
    expect(boardStatus("submitted", [{ status: "revision_needed" }])).toBe("revision_needed");
    expect(boardStatus("submitted", [{ status: "approved" }, { status: "revision_needed" }])).toBe("revision_needed");
  });

  it("uses a shared status when several assignees agree", () => {
    expect(boardStatus("submitted", [{ status: "approved" }, { status: "approved" }])).toBe("approved");
  });

  it("falls back to the task status when assignees disagree or there are none", () => {
    expect(boardStatus("submitted", [{ status: "approved" }, { status: "pending" }])).toBe("submitted");
    expect(boardStatus("in_progress", [])).toBe("in_progress");
    expect(boardStatus("in_progress", null)).toBe("in_progress");
    expect(boardStatus("in_progress", undefined)).toBe("in_progress");
  });

  it("ignores assignees with no status", () => {
    expect(boardStatus("submitted", [{ status: null }, {}])).toBe("submitted");
  });

  it("never un-hides paid or cancelled tasks, whatever the assignee says", () => {
    expect(boardStatus("paid", [{ status: "completed" }])).toBe("paid");
    expect(boardStatus("cancelled", [{ status: "submitted" }])).toBe("cancelled");
    expect(columnForStatus(boardStatus("paid", [{ status: "completed" }]))).toBeUndefined();
  });

  it("lands each of the mismatches seen on live data in the right column", () => {
    expect(columnForStatus(boardStatus("submitted", [{ status: "revision_needed" }]))?.label).toBe("Revision");
    expect(columnForStatus(boardStatus("submitted", [{ status: "approved" }]))?.label).toBe("Approved");
    expect(columnForStatus(boardStatus("pending", [{ status: "submitted" }]))?.label).toBe("Submitted");
  });
});
