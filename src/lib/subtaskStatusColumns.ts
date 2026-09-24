// Board View column ↔ AssignedTaskStatus mapping — Subtasks kanban (Part B,
// docs/objective-foundation-feature.md).
//
// This is the ONE place column/status logic lives for the Subtasks board. Don't
// scatter column-membership or drop-target-status logic anywhere else — if boss's
// answer on the open sub-questions changes the grouping below, this file is the
// only thing that should need to change.
//
// Boss confirmed (docs/objective-foundation-feature.md, "Answers from boss"):
// 6 hardcoded columns — Pending → In Progress → Submitted → Reviewed → Approved →
// Completed. NOT a configurable settings screen.
//
// Still open (docs/objective-foundation-feature.md, "Remaining gap"): three
// sub-questions on exactly how the 11-value AssignedTaskStatus enum maps onto her
// 6 labels. Each guess below is called out inline — flip it in one place once she
// answers.
import type { AssignedTaskStatus } from "@/types/database";

export interface BoardColumn {
  /** Stable key for the column (used as React key + drop target id). */
  key: string;
  /** Column header label, exactly as boss specified. */
  label: string;
  /** Every AssignedTaskStatus that renders as a card in this column. */
  statuses: AssignedTaskStatus[];
  /**
   * Status applied to a card dropped into this column. Always the first entry in
   * `statuses` — the column's "primary"/default status.
   */
  dropStatus: AssignedTaskStatus;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: "pending",
    label: "Pending",
    // TBD, pending boss confirmation: she didn't say whether `unassigned`/`on_queue`
    // tasks show under Pending or are hidden until picked up. Best guess: show them
    // here so nothing silently disappears from the board.
    statuses: ["pending", "unassigned", "on_queue"],
    dropStatus: "pending",
  },
  {
    key: "in_progress",
    label: "In Progress",
    statuses: ["in_progress"],
    dropStatus: "in_progress",
  },
  {
    key: "submitted",
    label: "Submitted",
    statuses: ["submitted"],
    dropStatus: "submitted",
  },
  {
    key: "reviewed",
    label: "Revision",
    // Houses items needing revision. `revision_needed` (sent back to the VA) is
    // the primary; `reviewing` (with a manager) also lands here per Toni.
    statuses: ["revision_needed", "reviewing"],
    dropStatus: "revision_needed",
  },
  {
    key: "approved",
    label: "Approved",
    statuses: ["approved"],
    dropStatus: "approved",
  },
  {
    key: "completed",
    label: "Completed",
    statuses: ["completed"],
    dropStatus: "completed",
  },
  // TBD, pending boss confirmation: `paid` and `cancelled` are assumed excluded
  // from the board entirely (board = active work view). If she wants them visible,
  // add a column here — don't add ad-hoc filtering elsewhere.
];

/**
 * The status a card should be shown under on the board.
 *
 * assigned_tasks.status (the task-level column) is left behind when a reviewer
 * approves or sends work back — those actions reliably write the assignee row
 * (assigned_task_assignees.status), not always the task row. Measured on live
 * data, 62 of 454 project tasks disagreed: revisions sitting under Submitted,
 * approved tasks under Submitted, submitted work under Pending. So the
 * assignee's status wins where it's unambiguous:
 *   - paid / cancelled stay as the task says (the board excludes them);
 *   - any assignee at revision_needed means the card needs revision;
 *   - a single assignee's status is used as-is;
 *   - several assignees agreeing use that shared status;
 *   - anything else (no assignees, or assignees who disagree) falls back to
 *     the task's own status, i.e. today's behaviour.
 */
export function boardStatus(
  taskStatus: string,
  assignees: ReadonlyArray<{ status?: string | null }> | null | undefined
): string {
  if (taskStatus === "paid" || taskStatus === "cancelled") return taskStatus;
  const statuses = (assignees ?? []).map((a) => a.status).filter((s): s is string => Boolean(s));
  if (statuses.length === 0) return taskStatus;
  if (statuses.includes("revision_needed")) return "revision_needed";
  const first = statuses[0];
  return statuses.every((s) => s === first) ? first : taskStatus;
}

/** Column a given status belongs to, or undefined if excluded from the board (see `paid`/`cancelled` note above). */
export function columnForStatus(status: string): BoardColumn | undefined {
  return BOARD_COLUMNS.find((col) => (col.statuses as string[]).includes(status));
}

/**
 * Column header accent, so the four columns read apart at a glance instead of
 * differing only by label text. Same text colors StatusBadge already puts on
 * a card's own badge (VAProjectsTab's STATUS_CLASSES) for that column's
 * dropStatus — no new colors, just carrying an existing one up to the header.
 */
export const COLUMN_ACCENT_TEXT: Record<string, string> = {
  pending: "text-stone",
  in_progress: "text-amber-500",
  submitted: "text-sky-600",
  reviewed: "text-amber-600",
  approved: "text-emerald-600",
  completed: "text-sage",
};
