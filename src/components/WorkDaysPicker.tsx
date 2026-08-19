"use client";

import { WEEKDAY_SHORT } from "@/lib/budget";

// The one weekday control, shared by Team Management (where an admin sets a
// member's schedule) and the VA Portal (where that member reads it back).
// Two places, one look — a schedule that renders differently in the portal
// than in the panel that set it invites "is this the same thing?".
//
// Read-only is the default: omit onChange and the chips render as plain
// labels, no buttons, nothing focusable.
export default function WorkDaysPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange?: (days: number[]) => void;
}) {
  const days = value;
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAY_SHORT.map((label, day) => {
        const on = days.includes(day);
        const tone = on
          ? "bg-sage text-white"
          : "bg-stone/10 text-stone";
        if (!onChange) {
          return (
            <span
              key={day}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${tone}`}
            >
              {label}
            </span>
          );
        }
        return (
          <button
            key={day}
            type="button"
            onClick={() => onChange(on ? days.filter((d) => d !== day) : [...days, day])}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
              on ? "bg-sage text-white hover:bg-sage/90" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
