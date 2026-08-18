import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, columnForStatus } from "./subtaskStatusColumns";
import type { AssignedTaskStatus } from "@/types/database";

// Mirrors the 11-value AssignedTaskStatus union from src/types/database.ts.
// TS types don't exist at runtime, so this list has to be kept in sync by
// hand — if that type ever gains/loses a value, update this list too.
const ALL_STATUSES: AssignedTaskStatus[] = [
  "unassigned",
  "pending",
  "on_queue",
  "in_progress",
  "submitted",
  "reviewing",
  "revision_needed",
  "approved",
  "completed",
  "paid",
  "cancelled",
];

// Statuses the board deliberately excludes today (see subtaskStatusColumns.ts
// comment: "board = active work view"). Not a bug — if boss's answer changes
// this, update this list and the "excluded" test below together.
const EXCLUDED_STATUSES: AssignedTaskStatus[] = ["paid", "cancelled"];

describe("subtaskStatusColumns", () => {
  it("maps every non-excluded status to exactly one column", () => {
    for (const status of ALL_STATUSES) {
      if (EXCLUDED_STATUSES.includes(status)) continue;

      const matchingColumns = BOARD_COLUMNS.filter((col) =>
        (col.statuses as string[]).includes(status)
      );

      expect(
        matchingColumns.length,
        `expected "${status}" to match exactly one column, matched: ${matchingColumns
          .map((c) => c.key)
          .join(", ") || "(none)"}`
      ).toBe(1);
    }
  });

  it("excludes paid and cancelled from every column, by design", () => {
    for (const status of EXCLUDED_STATUSES) {
      expect(columnForStatus(status)).toBeUndefined();
      for (const col of BOARD_COLUMNS) {
        expect((col.statuses as string[]).includes(status)).toBe(false);
      }
    }
  });

  it("accounts for all 11 statuses between mapped columns and the excluded set", () => {
    const mapped = BOARD_COLUMNS.flatMap((col) => col.statuses as string[]);
    const covered = new Set([...mapped, ...EXCLUDED_STATUSES]);
    for (const status of ALL_STATUSES) {
      expect(covered.has(status), `"${status}" falls through with no column and isn't in EXCLUDED_STATUSES`).toBe(true);
    }
  });

  // Pins today's TBD guesses (docs/objective-foundation-feature.md, "Remaining
  // gap") so that if boss's eventual answer changes the mapping, these
  // specific assertions are what break — telling us exactly what to update.
  describe("current TBD guesses", () => {
    it("revision_needed groups into Submitted", () => {
      expect(columnForStatus("revision_needed")?.key).toBe("submitted");
    });

    it("unassigned groups into Pending", () => {
      expect(columnForStatus("unassigned")?.key).toBe("pending");
    });

    it("on_queue groups into Pending", () => {
      expect(columnForStatus("on_queue")?.key).toBe("pending");
    });
  });

  it("gives every column a dropStatus that is one of its own statuses", () => {
    for (const col of BOARD_COLUMNS) {
      expect(col.statuses).toContain(col.dropStatus);
    }
  });

  it("columnForStatus returns undefined for a status it doesn't recognize", () => {
    expect(columnForStatus("not_a_real_status")).toBeUndefined();
  });
});
