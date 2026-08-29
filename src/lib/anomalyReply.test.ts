import { describe, it, expect } from "vitest";
import { parseAnomalyReply, parseClockInput } from "@/lib/anomalyReply";
import type { ShiftAnomalyFinding, ShiftLogRow } from "@/lib/shiftAnomalies";

// The parser decides what happens to billable hours off a line of free text,
// so what it *refuses* matters as much as what it accepts. Most of these cases
// assert a refusal.

const SESSION_DATE = "2026-08-26";

const breakLog: ShiftLogRow = {
  id: 101,
  task_name: "Break",
  category: "Break",
  billable: true,
  start_time: "2026-08-26T16:04:00.000Z",
  end_time: "2026-08-26T16:36:00.000Z",
  duration_ms: 32 * 60_000,
};

const taskLog: ShiftLogRow = {
  id: 102,
  task_name: "Client calls",
  category: "Task",
  billable: true,
  start_time: "2026-08-26T18:00:00.000Z",
  end_time: "2026-08-26T19:30:00.000Z",
  duration_ms: 90 * 60_000,
};

const billedBreak: ShiftAnomalyFinding = {
  type: "billed_break",
  logId: 101,
  logIds: [101],
  taskName: "Break",
  startTime: breakLog.start_time,
  endTime: breakLog.end_time,
  windowStart: breakLog.start_time,
  windowEnd: breakLog.end_time,
  minutes: 32,
  detail: "Break marked billable (32 min)",
};

const overlap: ShiftAnomalyFinding = {
  type: "overlap",
  logId: 102,
  logIds: [102, 103],
  taskName: "Client calls",
  startTime: taskLog.start_time,
  endTime: taskLog.end_time,
  windowStart: "2026-08-26T18:10:00.000Z",
  windowEnd: "2026-08-26T18:28:00.000Z",
  minutes: 18,
  detail: "overlaps by 18 min",
};

const logs = [breakLog, taskLog];

function parse(text: string, findings = [billedBreak]) {
  return parseAnomalyReply(text, findings, logs, SESSION_DATE);
}

describe("parseClockInput", () => {
  it("reads 12-hour times", () => {
    expect(parseClockInput("3:40pm")).toBe("15:40");
    expect(parseClockInput("3:40 PM")).toBe("15:40");
    expect(parseClockInput("9:05am")).toBe("09:05");
    expect(parseClockInput("3pm")).toBe("15:00");
    expect(parseClockInput("12am")).toBe("00:00");
    expect(parseClockInput("12pm")).toBe("12:00");
  });

  it("reads unambiguous 24-hour times", () => {
    expect(parseClockInput("15:40")).toBe("15:40");
    expect(parseClockInput("09:05")).toBe("09:05");
  });

  it("refuses a bare hour with no am/pm, rather than guessing", () => {
    // "set end time to 3" is either 3am or 3pm; picking one silently is how a
    // short day becomes a twenty-hour one.
    expect(parseClockInput("3")).toBeNull();
  });

  it("refuses nonsense", () => {
    expect(parseClockInput("3:75pm")).toBeNull();
    expect(parseClockInput("25:00")).toBeNull();
    expect(parseClockInput("later")).toBeNull();
  });
});

describe("parseAnomalyReply", () => {
  it("reads a delete", () => {
    const result = parse("delete the break entry");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.logId).toBe(101);
    expect(result.fix.changes.deleted_at).toBeTruthy();
  });

  it("reads a non-billable flip", () => {
    for (const phrasing of ["not billable", "make it unbillable", "non-billable", "don't bill it"]) {
      const result = parse(phrasing);
      expect(result.ok, phrasing).toBe(true);
      if (!result.ok) continue;
      expect(result.fix.changes).toEqual({ billable: "false" });
    }
  });

  it("converts an end time to the org timezone, not the server's", () => {
    const result = parse("set end time to 3:40pm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3:40pm Eastern on 2026-08-26 (EDT, UTC-4) is 19:40 UTC. A server reading
    // the wall clock as its own local time would store 15:40Z instead — four
    // hours of billable time out of nowhere.
    expect(result.fix.changes.end_time).toBe("2026-08-26T19:40:00.000Z");
  });

  it("reads a start time", () => {
    const result = parse("set start time to 09:15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.changes.start_time).toBe("2026-08-26T13:15:00.000Z");
  });

  it("picks the item by leading number", () => {
    const result = parse("2 delete", [billedBreak, overlap]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.findingIndex).toBe(1);
    expect(result.fix.logId).toBe(102);
  });

  it("picks the item by keyword when only one matches", () => {
    const result = parse("the overlap is wrong, delete it", [billedBreak, overlap]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.findingIndex).toBe(1);
  });

  it("asks again when several items are flagged and none is named", () => {
    const result = parse("delete it", [billedBreak, overlap]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/which item/i);
  });

  it("asks again on an out-of-range item number", () => {
    const result = parse("7 delete", [billedBreak, overlap]);
    expect(result.ok).toBe(false);
  });

  it("asks again on an unreadable time rather than dropping the field", () => {
    const result = parse("set end time to sometime after lunch");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/could not read that time/i);
  });

  it("refuses an instruction it does not understand", () => {
    const result = parse("just fix it please");
    expect(result.ok).toBe(false);
  });

  it("refuses when the shift had nothing flagged", () => {
    const result = parseAnomalyReply("delete it", [], logs, SESSION_DATE);
    expect(result.ok).toBe(false);
  });
});
