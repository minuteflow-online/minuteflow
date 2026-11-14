import { describe, expect, it } from "vitest";
import { answeredSubmission } from "./submissionThread";

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
