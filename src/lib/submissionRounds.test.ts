import { describe, expect, it } from "vitest";
import { computeSubmissionRounds } from "./submissionRounds";

const TZ = "America/New_York";

const noSchedule = { isOutputBased: false, scheduledStart: null, scheduledEnd: null, plannedMinutes: null };

describe("computeSubmissionRounds", () => {
  it("dates a submission to the day the work started, not the day it was handed in", () => {
    // Started Monday 2pm ET, picked it up again Tuesday, submitted Tuesday.
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-08T20:00:00Z" }], // Tue 4pm ET
      revisions: [],
      logs: [
        { start_time: "2026-09-07T18:00:00Z", duration_ms: 3_600_000 }, // Mon 2pm ET
        { start_time: "2026-09-08T14:00:00Z", duration_ms: 1_800_000 }, // Tue 10am ET
      ],
      task: noSchedule,
      timezone: TZ,
    });

    expect(result.workStartDate).toBe("2026-09-07");
    // Both sittings count: broken-up hours still sum to the round's total.
    expect(result.durationMs).toBe(5_400_000);
    expect(result.timeSource).toBe("logged");
  });

  it("puts a revision on the day the rework started and counts only that round's hours", () => {
    const results = computeSubmissionRounds({
      submissions: [
        { id: 1, created_at: "2026-09-07T20:00:00Z" }, // original, Mon
        { id: 2, created_at: "2026-09-10T20:00:00Z" }, // rework, Thu
      ],
      revisions: [{ created_at: "2026-09-08T15:00:00Z" }], // Tue 11am ET
      logs: [
        { start_time: "2026-09-07T18:00:00Z", duration_ms: 3_600_000 }, // round 0, Mon
        { start_time: "2026-09-09T13:00:00Z", duration_ms: 1_200_000 }, // round 1, Wed 9am ET
        { start_time: "2026-09-10T13:00:00Z", duration_ms: 600_000 }, // round 1, Thu
      ],
      task: noSchedule,
      timezone: TZ,
    });

    expect(results[0]).toMatchObject({ round: 0, workStartDate: "2026-09-07", durationMs: 3_600_000 });
    // Rework began Wednesday even though it was handed in Thursday.
    expect(results[1]).toMatchObject({ round: 1, workStartDate: "2026-09-09", durationMs: 1_800_000 });
  });

  it("never lets two submissions in one round claim the same hours", () => {
    const results = computeSubmissionRounds({
      submissions: [
        { id: 1, created_at: "2026-09-07T19:00:00Z" },
        { id: 2, created_at: "2026-09-07T21:00:00Z" }, // resubmitted, no revision between
      ],
      revisions: [],
      logs: [{ start_time: "2026-09-07T18:00:00Z", duration_ms: 3_600_000 }],
      task: noSchedule,
      timezone: TZ,
    });

    expect(results[0].durationMs).toBe(3_600_000);
    expect(results[1].durationMs).toBe(0);
    expect(results[1].timeSource).toBe("counted");
    // Two submissions, one round's worth of time.
    expect(results.reduce((sum, r) => sum + r.durationMs, 0)).toBe(3_600_000);
  });

  it("registers no time for output-based work, which is never clocked", () => {
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-08T20:00:00Z" }],
      revisions: [],
      logs: [],
      task: {
        isOutputBased: true,
        // Even with a block booked, output-based work contributes no hours.
        scheduledStart: "2026-09-08T13:00:00Z",
        scheduledEnd: "2026-09-08T17:00:00Z",
        plannedMinutes: 240,
      },
      timezone: TZ,
    });

    expect(result.durationMs).toBe(0);
    expect(result.timeSource).toBe("none");
    // Still dated by the block it was meant to be worked in.
    expect(result.workStartDate).toBe("2026-09-08");
  });

  it("falls back to the block booked in the task editor when nothing was logged", () => {
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-09T22:00:00Z" }],
      revisions: [],
      logs: [],
      task: {
        isOutputBased: false,
        scheduledStart: "2026-09-09T13:00:00Z", // 9am ET
        scheduledEnd: "2026-09-09T17:00:00Z", // 1pm ET
        plannedMinutes: null,
      },
      timezone: TZ,
    });

    expect(result.durationMs).toBe(4 * 3_600_000);
    expect(result.timeSource).toBe("scheduled");
    expect(result.workStartDate).toBe("2026-09-09");
  });

  it("uses the editor's duration field when a block has no times", () => {
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-09T22:00:00Z" }],
      revisions: [],
      logs: [],
      task: { isOutputBased: false, scheduledStart: null, scheduledEnd: null, plannedMinutes: 90 },
      timezone: TZ,
    });

    expect(result.durationMs).toBe(90 * 60_000);
    expect(result.timeSource).toBe("scheduled");
    // Nothing says when it started, so it sits on its submission date.
    expect(result.workStartDate).toBe("2026-09-09");
  });

  it("keeps a submission with nothing to go on, at zero time", () => {
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-09T22:00:00Z" }],
      revisions: [],
      logs: [],
      task: noSchedule,
      timezone: TZ,
    });

    expect(result.durationMs).toBe(0);
    expect(result.timeSource).toBe("none");
    expect(result.workStartDate).toBe("2026-09-09");
  });

  it("dates by org time, not UTC, across the midnight boundary", () => {
    // 1am UTC on the 9th is still 9pm ET on the 8th.
    const [result] = computeSubmissionRounds({
      submissions: [{ id: 1, created_at: "2026-09-09T02:00:00Z" }],
      revisions: [],
      logs: [{ start_time: "2026-09-09T01:00:00Z", duration_ms: 600_000 }],
      task: noSchedule,
      timezone: TZ,
    });

    expect(result.workStartDate).toBe("2026-09-08");
  });
});
