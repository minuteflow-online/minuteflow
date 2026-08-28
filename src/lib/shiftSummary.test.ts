import { describe, it, expect } from "vitest";
import { summarize, humanDuration, formatSummaryLine } from "@/lib/shiftSummary";

const NOW = new Date("2026-08-27T23:00:00.000Z").getTime();

function log(over: Partial<Parameters<typeof summarize>[0][number]> = {}) {
  return {
    category: "Task",
    billable: true,
    start_time: "2026-08-27T13:00:00.000Z",
    end_time: "2026-08-27T14:00:00.000Z",
    duration_ms: 60 * 60_000,
    ...over,
  };
}

describe("humanDuration", () => {
  it("drops the hours when there are none", () => {
    expect(humanDuration(47 * 60_000)).toBe("47m");
    expect(humanDuration(0)).toBe("0m");
  });

  it("splits hours and minutes", () => {
    expect(humanDuration(8 * 3_600_000 + 12 * 60_000)).toBe("8h 12m");
    // A whole number of hours drops the empty minutes half.
    expect(humanDuration(8 * 3_600_000)).toBe("8h");
  });
});

describe("summarize", () => {
  it("totals a normal day", () => {
    const summary = summarize(
      [
        log({ duration_ms: 4 * 3_600_000 }),
        log({ category: "Break", billable: false, duration_ms: 30 * 60_000 }),
        log({ category: "Personal", billable: false, duration_ms: 20 * 60_000 }),
        log({ duration_ms: 3 * 3_600_000 }),
      ],
      NOW
    );
    expect(humanDuration(summary.totalMs)).toBe("7h 50m");
    expect(humanDuration(summary.billableMs)).toBe("7h");
    // Break and Personal read as one number, which is what was asked for.
    expect(humanDuration(summary.awayMs)).toBe("50m");
  });

  it("counts a wrongly-billable break in both billable and away", () => {
    // Not a bug: this is exactly the anomaly the finance review looks for, and
    // hiding it here would make the totals disagree with that alert.
    const summary = summarize([log({ category: "Break", billable: true, duration_ms: 30 * 60_000 })], NOW);
    expect(summary.billableMs).toBe(30 * 60_000);
    expect(summary.awayMs).toBe(30 * 60_000);
  });

  it("measures an entry still open when the webhook fires", () => {
    // The clock-out writes the session row and closes the final log separately;
    // this alert can land between the two. Without the fallback that last
    // stretch counts as zero and the day reads short.
    const summary = summarize(
      [log({ duration_ms: null, end_time: null, start_time: "2026-08-27T22:00:00.000Z" })],
      NOW
    );
    expect(humanDuration(summary.totalMs)).toBe("1h");
  });

  it("falls back to start/end when duration_ms is missing but the log is closed", () => {
    const summary = summarize(
      [log({ duration_ms: null, start_time: "2026-08-27T13:00:00.000Z", end_time: "2026-08-27T15:30:00.000Z" })],
      NOW
    );
    expect(humanDuration(summary.totalMs)).toBe("2h 30m");
  });

  it("never returns a negative duration", () => {
    const summary = summarize(
      [log({ duration_ms: null, start_time: "2026-08-27T15:00:00.000Z", end_time: "2026-08-27T14:00:00.000Z" })],
      NOW
    );
    expect(summary.totalMs).toBe(0);
  });
});

describe("formatSummaryLine", () => {
  it("prints nothing for a day with no entries", () => {
    // A row of zeroes looks like a broken tracker and invites a question.
    expect(formatSummaryLine(summarize([], NOW))).toBeNull();
  });

  it("puts the three numbers on one line", () => {
    const line = formatSummaryLine(
      summarize([log({ duration_ms: 8 * 3_600_000 }), log({ category: "Break", billable: false, duration_ms: 30 * 60_000 })], NOW)
    );
    expect(line).toBe(
      "⏱ Total <b>8h 30m</b> · Billable <b>8h</b> · Break/personal <b>30m</b>"
    );
  });
});
