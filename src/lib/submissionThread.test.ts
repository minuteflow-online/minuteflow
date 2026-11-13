import { describe, expect, it } from "vitest";
import { answeredSubmission, revisionHistory } from "./submissionThread";

const e = (id: number, message_type: string, created_at: string) => ({ id, message_type, created_at });

const thread = [
  e(1, "submission", "2026-11-10T15:00:00Z"),
  e(2, "revision", "2026-11-13T02:00:00Z"),
  e(3, "submission", "2026-11-13T20:00:00Z"),
  e(4, "comment", "2026-11-14T01:00:00Z"),
];

describe("answeredSubmission", () => {
  it("attaches a late revision request to the submission before it", () => {
    expect(answeredSubmission(thread, thread[1])?.id).toBe(1);
  });

  it("attaches a note to the newest submission before it", () => {
    expect(answeredSubmission(thread, thread[3])?.id).toBe(3);
  });

  it("a submission answers for itself", () => {
    expect(answeredSubmission(thread, thread[2])?.id).toBe(3);
  });

  it("a note before any submission goes to the first one", () => {
    const early = e(9, "comment", "2026-11-09T00:00:00Z");
    expect(answeredSubmission([...thread, early], early)?.id).toBe(1);
  });

  it("null when there's no submission", () => {
    const note = e(9, "comment", "2026-11-09T00:00:00Z");
    expect(answeredSubmission([note], note)).toBeNull();
  });
});

describe("revisionHistory", () => {
  it("lists each request with the submission it was about", () => {
    const items = [...thread, e(5, "revision", "2026-11-15T00:00:00Z")];
    const h = revisionHistory(items);
    expect(h.map((r) => [r.revision.id, r.submission?.id, r.submissionIndex, r.undone])).toEqual([
      [2, 1, 0, false],
      [5, 3, 1, false],
    ]);
  });

  it("marks a request undone by a later reversal", () => {
    const items = [
      ...thread,
      e(5, "revision", "2026-11-15T00:00:00Z"),
      e(6, "revision_reversed", "2026-11-15T00:05:00Z"),
    ];
    const h = revisionHistory(items);
    expect(h.map((r) => r.undone)).toEqual([false, true]);
  });
});
