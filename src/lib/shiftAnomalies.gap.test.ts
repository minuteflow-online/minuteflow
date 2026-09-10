import { describe, it, expect } from "vitest";
import { checkShiftAnomalies, type ShiftLogRow } from "@/lib/shiftAnomalies";

// The bug this file guards against: Charinade's CRM task on 2026-09-09 closed
// after 21 seconds while her screenshots kept arriving against it for another
// 1h50m — real, evidenced work that never showed up in time_logs at all. A
// plain sum of durations had no way to notice; this is the check that does.

/** Minimal chainable fake covering exactly the calls checkShiftAnomalies
 *  makes: one query against time_logs (resolves with the row set), and one
 *  count-only query against task_screenshots per gap found (resolves with a
 *  count keyed by whichever log_id was queried). */
function fakeSupabase(rows: ShiftLogRow[], screenshotCountsByLogId: Record<number, number> = {}) {
  return {
    from(table: string) {
      if (table === "time_logs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  order: () => Promise.resolve({ data: rows }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "task_screenshots") {
        let logId: number | undefined;
        const builder = {
          select: () => builder,
          eq: (col: string, val: number) => {
            if (col === "log_id") logId = val;
            return builder;
          },
          is: () => builder,
          gt: () => builder,
          lt: () => builder,
          then: (resolve: (v: { count: number }) => void) =>
            resolve({ count: logId !== undefined ? (screenshotCountsByLogId[logId] ?? 0) : 0 }),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function row(overrides: Partial<ShiftLogRow> & Pick<ShiftLogRow, "id" | "start_time">): ShiftLogRow {
  return {
    task_name: "Task",
    category: "Task",
    billable: true,
    end_time: null,
    duration_ms: 0,
    ...overrides,
  };
}

describe("checkShiftAnomalies — gaps", () => {
  it("stays clean when every entry hands off contiguously", async () => {
    const rows = [
      row({ id: 1, start_time: "2026-09-09T14:42:00.000Z", end_time: "2026-09-09T15:00:00.000Z" }),
      row({ id: 2, start_time: "2026-09-09T15:00:00.000Z", end_time: "2026-09-09T15:30:00.000Z" }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows), "u1", "2026-09-09");
    expect(result.clean).toBe(true);
  });

  it("ignores a gap of a couple minutes as ordinary task-switch lag", async () => {
    const rows = [
      row({ id: 1, start_time: "2026-09-09T14:42:00.000Z", end_time: "2026-09-09T15:00:00.000Z" }),
      row({ id: 2, start_time: "2026-09-09T15:02:00.000Z", end_time: "2026-09-09T15:30:00.000Z" }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows), "u1", "2026-09-09");
    expect(result.clean).toBe(true);
  });

  it("flags silent_gap when screenshots prove the task kept running", async () => {
    const rows = [
      row({
        id: 6375,
        task_name: "CRM Technical Set-up/update",
        start_time: "2026-09-09T15:59:38.722Z",
        end_time: "2026-09-09T15:59:59.999Z",
      }),
      row({ id: 6378, start_time: "2026-09-09T17:49:59.124Z", end_time: "2026-09-09T17:50:08.717Z" }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows, { 6375: 33 }), "u1", "2026-09-09");
    expect(result.clean).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ type: "silent_gap", logIds: [6375, 6378] });
    expect(result.findings[0].detail).toContain("33 screenshot");
    expect(result.findings[0].minutes).toBeCloseTo(109.99, 1);
  });

  it("flags unlogged_gap when there's no evidence anything was happening", async () => {
    const rows = [
      row({ id: 1, start_time: "2026-09-09T14:42:00.000Z", end_time: "2026-09-09T15:00:00.000Z" }),
      row({ id: 2, start_time: "2026-09-09T15:30:00.000Z", end_time: "2026-09-09T16:00:00.000Z" }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows, { 1: 0 }), "u1", "2026-09-09");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].type).toBe("unlogged_gap");
    expect(result.findings[0].detail).not.toContain("screenshot(s) kept arriving");
  });

  it("does not flag a gap after a Break, even with trailing screenshots", async () => {
    // Break is non-billable by design — a gap after it ends isn't missing
    // billable time, whatever screenshots turn up during it.
    const rows = [
      row({
        id: 1,
        task_name: "Break",
        category: "Break",
        billable: false,
        start_time: "2026-09-09T17:50:08.000Z",
        end_time: "2026-09-09T18:48:07.000Z",
      }),
      row({ id: 2, start_time: "2026-09-09T19:00:00.000Z", end_time: "2026-09-09T19:30:00.000Z" }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows, { 1: 5 }), "u1", "2026-09-09");
    expect(result.clean).toBe(true);
  });

  it("does not flag the gap between clocking out and clocking back in", async () => {
    const rows = [
      row({ id: 1, start_time: "2026-09-09T14:42:00.000Z", end_time: "2026-09-09T15:00:00.000Z" }),
      row({
        id: 2,
        task_name: "Clocked Out",
        category: "Clock Out",
        billable: false,
        start_time: "2026-09-09T15:00:00.000Z",
        end_time: "2026-09-09T15:00:00.000Z",
      }),
      row({
        id: 3,
        task_name: "Clock In",
        category: "Planning",
        start_time: "2026-09-09T19:00:00.000Z",
        end_time: "2026-09-09T19:05:00.000Z",
      }),
    ];
    const result = await checkShiftAnomalies(fakeSupabase(rows), "u1", "2026-09-09");
    expect(result.clean).toBe(true);
  });
});
