import { describe, expect, it } from "vitest";
import type { SubtaskRow } from "./VAProjectsTab";

// VAProjectsTab.tsx's `vaProgress` useMemo (lines ~481-492) isn't an
// importable pure function — it's computed inside the component, and its
// `pct` figure is computed further still, inline in JSX at render time
// (line ~1047: Math.round((completed / total) * 100)). Testing it without
// rendering the component means copying the computation here instead of
// importing it.
//
// This copy covers `completed`/`total` only — NOT `pct`, which stays
// untested since it never leaves the JSX. If VAProjectsTab.tsx's useMemo
// body changes, this copy needs to be updated to match by hand.
//
// DONE_STATUSES mirrors VAProjectsTab.tsx line ~93 — keep in sync.
const DONE_STATUSES = new Set(["completed", "approved", "paid"]);

interface VaProgressEntry {
  vaId: string;
  total: number;
  completed: number;
}

function computeVaProgress(
  vaIds: string[],
  tasks: Pick<SubtaskRow, "status" | "assigned_task_assignees">[]
): VaProgressEntry[] {
  return vaIds
    .map((vaId) => {
      const vaTasks = tasks.filter(
        (t) => t.status !== "cancelled" && (t.assigned_task_assignees ?? []).some((a) => a.va_id === vaId)
      );
      const completed = vaTasks.filter((t) => DONE_STATUSES.has(t.status)).length;
      return { vaId, total: vaTasks.length, completed };
    })
    .filter((p) => p.total > 0);
}

function task(
  status: string,
  vaIds: string[]
): Pick<SubtaskRow, "status" | "assigned_task_assignees"> {
  return {
    status,
    assigned_task_assignees: vaIds.map((va_id) => ({ va_id })),
  };
}

describe("VAProjectsTab vaProgress (completed/total)", () => {
  it("counts some completed, some not, correctly", () => {
    const tasks = [
      task("completed", ["va-1"]),
      task("in_progress", ["va-1"]),
      task("submitted", ["va-1"]),
    ];
    const [entry] = computeVaProgress(["va-1"], tasks);
    expect(entry).toMatchObject({ vaId: "va-1", total: 3, completed: 1 });
    // pct isn't part of this copy, but the ratio it would use is well-defined:
    expect(Math.round((entry.completed / entry.total) * 100)).toBe(33);
  });

  it("excludes a VA with 0 total tasks instead of dividing by zero", () => {
    const tasks = [task("completed", ["va-1"])]; // none assigned to va-2
    const result = computeVaProgress(["va-1", "va-2"], tasks);
    expect(result.map((p) => p.vaId)).toEqual(["va-1"]);
    expect(result.find((p) => p.vaId === "va-2")).toBeUndefined();
  });

  it("reports 100% when every task is done", () => {
    const tasks = [task("completed", ["va-1"]), task("approved", ["va-1"])];
    const [entry] = computeVaProgress(["va-1"], tasks);
    expect(entry).toMatchObject({ total: 2, completed: 2 });
    expect(Math.round((entry.completed / entry.total) * 100)).toBe(100);
  });

  it("counts completed, approved, and paid as done; other statuses as not done", () => {
    const doneTasks = [
      task("completed", ["va-1"]),
      task("approved", ["va-1"]),
      task("paid", ["va-1"]),
    ];
    const notDoneTasks = [
      task("unassigned", ["va-1"]),
      task("pending", ["va-1"]),
      task("on_queue", ["va-1"]),
      task("in_progress", ["va-1"]),
      task("submitted", ["va-1"]),
      task("reviewing", ["va-1"]),
      task("revision_needed", ["va-1"]),
    ];
    const [entry] = computeVaProgress(["va-1"], [...doneTasks, ...notDoneTasks]);
    expect(entry.total).toBe(doneTasks.length + notDoneTasks.length);
    expect(entry.completed).toBe(doneTasks.length);
  });

  it("excludes cancelled tasks from both numerator and denominator", () => {
    const tasks = [
      task("completed", ["va-1"]),
      task("cancelled", ["va-1"]),
      task("cancelled", ["va-1"]),
    ];
    const [entry] = computeVaProgress(["va-1"], tasks);
    // total is 1 (the completed task), not 3 — the 2 cancelled tasks don't
    // count toward total, and obviously don't count as completed either.
    expect(entry).toMatchObject({ total: 1, completed: 1 });
  });
});
