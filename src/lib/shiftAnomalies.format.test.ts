import { describe, it, expect } from "vitest";
import { formatShiftMessage } from "@/lib/shiftAnomalyFormat";
import { compactSpan, compactDuration } from "@/lib/shiftAnomalyFormat";
import type { ShiftAnomalyResult } from "@/lib/shiftAnomalies";

// The first live alert was judged hard to understand: an aligned sixteen-row
// table that wrapped on a phone, with the one line that mattered buried in it.
// These tests hold the shape that replaced it — finding first, a few entries
// of context, nothing padded.

const logs = [
  {
    id: 100,
    task_name: "Clock In",
    category: "Sorting Tasks",
    billable: true,
    start_time: "2026-08-26T18:00:00.000Z",
    end_time: "2026-08-26T18:01:00.000Z",
    duration_ms: 60_000,
  },
  {
    id: 101,
    task_name: "SMC_Planning",
    category: "Task",
    billable: true,
    start_time: "2026-08-26T18:19:00.000Z",
    end_time: "2026-08-26T20:01:00.000Z",
    duration_ms: 102 * 60_000,
  },
  {
    // The real shape of the row that broke the first alert: 26 minutes of
    // elapsed time carrying duration_ms = 0.
    id: 5815,
    task_name: "Break",
    category: "Break",
    billable: true,
    start_time: "2026-08-26T20:01:00.000Z",
    end_time: "2026-08-26T20:27:00.000Z",
    duration_ms: 0,
  },
  {
    id: 103,
    task_name: "SMC_Planning",
    category: "Task",
    billable: true,
    start_time: "2026-08-26T20:27:00.000Z",
    end_time: "2026-08-26T20:29:00.000Z",
    duration_ms: 2 * 60_000,
  },
  {
    id: 104,
    task_name: "Lunch",
    category: "Personal",
    billable: false,
    start_time: "2026-08-26T21:00:00.000Z",
    end_time: "2026-08-26T21:30:00.000Z",
    duration_ms: 30 * 60_000,
  },
];

const billedBreak: ShiftAnomalyResult = {
  clean: false,
  logs,
  findings: [
    {
      type: "billed_break",
      logId: 5815,
      logIds: [5815],
      taskName: "Break",
      startTime: "2026-08-26T20:01:00.000Z",
      endTime: "2026-08-26T20:27:00.000Z",
      windowStart: "2026-08-26T20:01:00.000Z",
      windowEnd: "2026-08-26T20:27:00.000Z",
      minutes: 26,
      detail: "Break marked billable (26 min)",
    },
  ],
};

describe("compactSpan", () => {
  it("prints the meridiem once when both ends share it", () => {
    expect(compactSpan("2026-08-26T20:01:00.000Z", "2026-08-26T20:27:00.000Z")).toBe("4:01–4:27p");
  });

  it("prints both when they straddle noon", () => {
    expect(compactSpan("2026-08-26T15:50:00.000Z", "2026-08-26T16:10:00.000Z")).toBe(
      "11:50a–12:10p"
    );
  });

  it("says so when the entry never closed", () => {
    expect(compactSpan("2026-08-26T20:01:00.000Z", null)).toBe("4:01p–open");
  });
});

describe("compactDuration", () => {
  it("stays tight, since these sit mid-line", () => {
    expect(compactDuration(26 * 60_000)).toBe("26m");
    expect(compactDuration(102 * 60_000)).toBe("1h42m");
    expect(compactDuration(2 * 3_600_000)).toBe("2h");
  });
});

describe("formatShiftMessage", () => {
  const message = formatShiftMessage("Flordeliz Mandin", "2026-08-26", billedBreak);

  it("names the problem in words, not a column heading", () => {
    expect(message).toContain("<b>Break billed as work</b>");
  });

  it("reports the real length of an entry whose duration_ms is 0", () => {
    // This is the bug the first live alert had: it called this break "0 min",
    // so the thing being flagged looked like nothing at all.
    expect(message).toContain("<b>Break billed as work</b> — 26 min");
    expect(message).not.toContain("0 min");
  });

  it("totals billable time by elapsed, not by duration_ms", () => {
    // 1m + 1h42m + 26m + 2m billable = 2h11m. The Personal 30m is excluded,
    // and the break's stored zero must not swallow its 26 minutes.
    expect(message).toContain("Day: <b>2h11m</b> billable · 5 entries");
  });

  it("shows the flagged entry with one either side, not the whole day", () => {
    expect(message).toContain("▸ 4:01–4:27p · Break · 26m");
    expect(message).toContain("  2:19–4:01p · SMC_Planning · 1h42m");
    expect(message).toContain("  4:27–4:29p · SMC_Planning · 2m");
    // Entries further away stay out of it.
    expect(message).not.toContain("Clock In");
    expect(message).not.toContain("Lunch");
  });

  it("pads nothing, so it reflows instead of shattering on a narrow screen", () => {
    expect(message).not.toContain("<pre>");
    expect(message).not.toMatch(/ {3,}\S/);
  });

  it("drops the item number when only one thing is flagged", () => {
    expect(message).not.toContain("[1]");
    expect(message).toContain("Reply “not billable”");
  });

  it("numbers the items and asks for one when several are flagged", () => {
    const two = formatShiftMessage("Flordeliz Mandin", "2026-08-26", {
      ...billedBreak,
      findings: [
        billedBreak.findings[0],
        {
          type: "overlap",
          logId: 103,
          logIds: [101, 103],
          taskName: "SMC_Planning",
          startTime: "2026-08-26T20:27:00.000Z",
          endTime: "2026-08-26T20:29:00.000Z",
          windowStart: "2026-08-26T20:27:00.000Z",
          windowEnd: "2026-08-26T20:29:00.000Z",
          minutes: 2,
          detail: "overlap",
        },
      ],
    });
    expect(two).toContain("[1] <b>Break billed as work</b>");
    expect(two).toContain("[2] <b>Two tasks counted at once</b>");
    expect(two).toContain("item number");
  });

  it("marks both entries of an overlap", () => {
    const overlap = formatShiftMessage("Flordeliz Mandin", "2026-08-26", {
      clean: false,
      logs,
      findings: [
        {
          type: "overlap",
          logId: 103,
          logIds: [101, 103],
          taskName: "SMC_Planning",
          startTime: "2026-08-26T20:27:00.000Z",
          endTime: "2026-08-26T20:29:00.000Z",
          windowStart: "2026-08-26T20:27:00.000Z",
          windowEnd: "2026-08-26T20:29:00.000Z",
          minutes: 2,
          detail: "overlap",
        },
      ],
    });
    expect(overlap).toContain("▸ 2:19–4:01p · SMC_Planning · 1h42m");
    expect(overlap).toContain("▸ 4:27–4:29p · SMC_Planning · 2m");
  });

  it("escapes a task name, which is free text", () => {
    const risky = formatShiftMessage("Flordeliz Mandin", "2026-08-26", {
      ...billedBreak,
      logs: logs.map((row) => (row.id === 5815 ? { ...row, task_name: "R&D <urgent>" } : row)),
    });
    expect(risky).toContain("R&amp;D &lt;urgent&gt;");
    expect(risky).not.toContain("<urgent>");
  });

  it("says a clean shift is clean without listing anything", () => {
    const clean = formatShiftMessage("Flordeliz Mandin", "2026-08-26", {
      clean: true,
      findings: [],
      logs,
    });
    expect(clean).toContain("Shift looks clean.");
    expect(clean).toContain("Day: <b>2h11m</b> billable · 5 entries");
    expect(clean).not.toContain("▸");
  });

  it("prints the whole thing for eyeballing", () => {
    console.log("\n" + message.replace(/<\/?b>/g, "").replace(/<\/?i>/g, "") + "\n");
    expect(message.length).toBeGreaterThan(0);
  });
});
