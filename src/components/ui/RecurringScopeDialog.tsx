"use client";

import type { RecurringScope } from "@/lib/recurringScope";

/**
 * Asked before a change to a task that belongs to a recurring series.
 *
 * "The 9am standup moves to 10am" almost never means only Tuesday, and
 * "cancel Friday" almost never means cancel it forever — so neither can be
 * assumed. The choice is presented once, at the moment it is made, rather than
 * being buried in a setting.
 */
export default function RecurringScopeDialog({
  action,
  taskName,
  onChoose,
  onCancel,
}: {
  action: "edit" | "delete";
  taskName: string;
  onChoose: (scope: RecurringScope) => void;
  onCancel: () => void;
}) {
  const isDelete = action === "delete";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-sand bg-white p-5 shadow-xl">
        <h3 className="text-sm font-bold text-espresso">
          {isDelete ? "Remove a repeating task" : "Update a repeating task"}
        </h3>
        <p className="mt-1 text-[12px] text-stone">
          <span className="font-semibold text-espresso">{taskName}</span> repeats on a schedule.
          {isDelete
            ? " Should this removal apply to this date only, or to this and every later one?"
            : " Should these changes apply to this date only, or to this and every later one?"}
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => onChoose("this")}
            className="w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-left transition-colors hover:bg-cream"
          >
            <span className="block text-[13px] font-semibold text-espresso">This occurrence only</span>
            <span className="block text-[11px] text-stone">
              {isDelete
                ? "Removes this date. The schedule carries on as normal."
                : "Changes this date. Every other one stays as it is."}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChoose("future")}
            className="w-full rounded-lg border-2 border-terracotta bg-terracotta-soft/40 px-3 py-2.5 text-left transition-colors hover:bg-terracotta-soft"
          >
            <span className="block text-[13px] font-semibold text-espresso">This and all later occurrences</span>
            <span className="block text-[11px] text-stone">
              {isDelete
                ? "Removes this date and every later one, and ends the schedule here. Dates already worked on are left alone."
                : "Changes this date and every later one, and updates the schedule so new dates match. Dates already worked on are left alone."}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-lg bg-stone/10 px-3 py-2 text-[12px] font-semibold text-stone transition-colors hover:bg-stone/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
