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

/** Column a given status belongs to, or undefined if excluded from the board (see `paid`/`cancelled` note above). */
export function columnForStatus(status: string): BoardColumn | undefined {
  return BOARD_COLUMNS.find((col) => (col.statuses as string[]).includes(status));
}
