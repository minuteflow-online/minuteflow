import { describe, it, expect } from "vitest";
import { formatShiftMessage, type ShiftAnomalyResult } from "@/lib/shiftAnomalies";

// The alert has to be readable at a glance in a phone-width chat, and the
// isolated window is the whole point of it — the day log says what happened,
// the window says which minutes are wrong.

const result: ShiftAnomalyResult = {
  clean: false,
  findings: [
    {
      type: "billed_break",
      logId: 101,
      logIds: [101],
      taskName: "Break",
      startTime: "2026-08-26T16:04:00.000Z",
      endTime: "2026-08-26T16:36:00.000Z",
      windowStart: "2026-08-26T16:04:00.000Z",
      windowEnd: "2026-08-26T16:36:00.000Z",
      minutes: 32,
      detail: "Break marked billable (32 min)",
    },
    {
      type: "overlap",
      logId: 103,
      logIds: [102, 103],
      taskName: "Design pass",
      startTime: "2026-08-26T18:10:00.000Z",
      endTime: "2026-08-26T19:00:00.000Z",
      windowStart: "2026-08-26T18:10:00.000Z",
      windowEnd: "2026-08-26T18:28:00.000Z",
      minutes: 18,
      detail: '"Design pass" (log 103) overlaps "Client calls" (log 102) by 18 min',
    },
  ],
  logs: [
    {
      id: 100,
      task_name: "Clock In",
      category: "Sorting Tasks",
      billable: true,
      start_time: "2026-08-26T13:02:00.000Z",
      end_time: "2026-08-26T13:24:00.000Z",
      duration_ms: 22 * 60_000,
    },
    {
      id: 101,
      task_name: "Break",
      category: "Break",
      billable: true,
      start_time: "2026-08-26T16:04:00.000Z",
      end_time: "2026-08-26T16:36:00.000Z",
      duration_ms: 32 * 60_000,
    },
    {
      id: 102,
      task_name: "Client calls",
      category: "Task",
      billable: true,
      start_time: "2026-08-26T18:00:00.000Z",
      end_time: "2026-08-26T18:28:00.000Z",
      duration_ms: 28 * 60_000,
    },
    {
      id: 103,
      task_name: "Design pass",
      category: "Task",
      billable: true,
      start_time: "2026-08-26T18:10:00.000Z",
      end_time: "2026-08-26T19:00:00.000Z",
      duration_ms: 50 * 60_000,
    },
    {
      id: 104,
      task_name: "Lunch",
      category: "Personal",
      billable: false,
      start_time: "2026-08-26T19:00:00.000Z",
      end_time: "2026-08-26T19:30:00.000Z",
      duration_ms: 30 * 60_000,
    },
  ],
};

describe("formatShiftMessage", () => {
  const message = formatShiftMessage("Arianne", "2026-08-26", result);

  it("numbers each finding so a reply can name one", () => {
    expect(message).toContain("<b>[1]</b>");
    expect(message).toContain("<b>[2]</b>");
  });

  it("shows the isolated window, not the whole entry, for an overlap", () => {
    // Entry 103 runs 2:10–3:00 PM ET but only 2:10–2:28 is double-counted, so
    // the finding line points at those 18 minutes. The full-day block below it
    // still shows the entry's real span — that is what makes the two useful
    // side by side, so the check is scoped to the findings section.
    const findingsSection = message.split("<b>Full day</b>")[0];
    expect(findingsSection).toContain("2:10 PM–2:28 PM");
    expect(findingsSection).not.toContain("2:10 PM–3:00 PM");
    expect(message).toContain("2:10 PM–3:00 PM");
  });

  it("itemizes the whole day in a monospace block", () => {
    expect(message).toContain("<pre>");
    expect(message).toContain("Clock In");
    expect(message).toContain("Design pass");
  });

  it("totals only billable time", () => {
    // 22 + 32 + 28 + 50 = 132 minutes billable; the 30-minute Personal is out.
    expect(message).toContain("Billable total: <b>2h 12m</b>");
  });

  it("escapes angle brackets in task names so the send is not rejected", () => {
    // Task names are free text. Telegram's HTML mode only requires & < > to be
    // escaped, but an unescaped one kills the whole message.
    const withMarkup = formatShiftMessage("Arianne", "2026-08-26", {
      ...result,
      logs: [{ ...result.logs[0], task_name: "R&D <urgent>" }],
    });
    expect(withMarkup).toContain("R&amp;D &lt;urgent&gt;");
    expect(withMarkup).not.toContain("<urgent>");
  });

  it("tells her how to reply", () => {
    expect(message).toContain("Nothing is written until you confirm");
  });

  it("still itemizes the day when the shift is clean", () => {
    const clean = formatShiftMessage("Arianne", "2026-08-26", {
      clean: true,
      findings: [],
      logs: result.logs,
    });
    expect(clean).toContain("no anomalies found");
    expect(clean).toContain("<pre>");
  });
});
