import { describe, it, expect } from "vitest";
import { summarize, humanDuration, money, formatSummaryLine } from "@/lib/shiftSummary";

const NOW = new Date("2026-08-27T23:00:00.000Z").getTime();

type Row = Parameters<typeof summarize>[0][number];

function log(over: Partial<Row> = {}): Row {
  return {
    category: "Task",
    billable: true,
    billing_type: "hourly",
    task_rate: null,
    start_time: "2026-08-27T13:00:00.000Z",
    end_time: "2026-08-27T14:00:00.000Z",
    duration_ms: 60 * 60_000,
    ...over,
  };
}

/** An output-based entry as the app actually writes one: a rate and no time. */
function fixed(rate: number, over: Partial<Row> = {}): Row {
  return log({
    billing_type: "fixed",
    task_rate: rate,
    duration_ms: 0,
    end_time: "2026-08-27T13:00:00.000Z",
    ...over,
  });
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

describe("money", () => {
  it("always shows two places", () => {
    expect(money(125.85)).toBe("$125.85");
    expect(money(20)).toBe("$20.00");
    expect(money(0)).toBe("$0.00");
  });
});

describe("summarize", () => {
  it("totals a normal hourly day", () => {
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
    expect(summary.fixedCount).toBe(0);
  });

  it("counts output-based work by task and value, never as time", () => {
    // Rhealin's real 2026-08-27 shift: nine fixed tasks, zero duration between
    // them. Summing minutes reported an empty day for a day's work.
    const summary = summarize(
      [2.75, 13.75, 2.75, 20, 30, 30, 2.75, 20, 3.85].map((rate) => fixed(rate)),
      NOW
    );
    expect(summary.fixedCount).toBe(9);
    expect(summary.fixedValue).toBeCloseTo(125.85, 2);
    expect(summary.totalMs).toBe(0);
    expect(summary.billableMs).toBe(0);
  });

  it("keeps fixed work out of the hourly totals even if it carries a duration", () => {
    // Per-task pay must never land in the number that answers "how many hours
    // do I owe?", whatever the row happens to have in duration_ms.
    const summary = summarize([fixed(20, { duration_ms: 45 * 60_000 })], NOW);
    expect(summary.totalMs).toBe(0);
    expect(summary.billableMs).toBe(0);
    expect(summary.fixedValue).toBe(20);
  });

  it("treats a null billing_type as hourly, the way older rows are", () => {
    const summary = summarize([log({ billing_type: null })], NOW);
    expect(summary.totalMs).toBe(60 * 60_000);
    expect(summary.fixedCount).toBe(0);
  });

  it("reads a task_rate that arrives as a string from PostgREST", () => {
    const summary = summarize([fixed(0, { task_rate: "13.75" })], NOW);
    expect(summary.fixedValue).toBeCloseTo(13.75, 2);
  });

  it("survives a fixed entry with no rate set", () => {
    const summary = summarize([fixed(0, { task_rate: null })], NOW);
    expect(summary.fixedCount).toBe(1);
    expect(summary.fixedValue).toBe(0);
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

  it("puts the three time numbers on one line", () => {
    const line = formatSummaryLine(
      summarize(
        [log({ duration_ms: 8 * 3_600_000 }), log({ category: "Break", billable: false, duration_ms: 30 * 60_000 })],
        NOW
      )
    );
    expect(line).toBe("⏱ Total <b>8h 30m</b> · Billable <b>8h</b> · Break/personal <b>30m</b>");
  });

  it("prints only the output line on a purely output-based day", () => {
    const line = formatSummaryLine(summarize([fixed(20), fixed(30)], NOW));
    expect(line).toBe("📦 Output-based: <b>2</b> tasks · <b>$50.00</b>");
    expect(line).not.toContain("Total");
  });

  it("prints both lines when the day had each kind of work", () => {
    const line = formatSummaryLine(summarize([log({ duration_ms: 2 * 3_600_000 }), fixed(13.75)], NOW));
    expect(line).toBe(
      "⏱ Total <b>2h</b> · Billable <b>2h</b> · Break/personal <b>0m</b>\n" +
        "📦 Output-based: <b>1</b> task · <b>$13.75</b>"
    );
  });
});
