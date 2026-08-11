"use client";

import { useState } from "react";

type Props = {
  columns: { key: string; label: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
};

// Lets each account choose which columns show in a table. Hidden columns
// aren't gone — their data is still reachable via the row's detail panel
// (TableRowDetailPanel), this just controls what's visible in the grid.
export default function ColumnVisibilityPicker({ columns, hidden, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso outline-none transition-all hover:border-walnut"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="18" rx="1" />
        </svg>
        Columns
        {hidden.size > 0 && (
          <span className="rounded-full bg-terracotta px-1.5 py-px text-[10px] font-bold leading-none text-white">{hidden.size}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-sand bg-white py-1 shadow-lg">
            {columns.map((col) => (
              <label key={col.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-parchment">
                <input
                  type="checkbox"
                  checked={!hidden.has(col.key)}
                  onChange={() => onToggle(col.key)}
                  className="accent-terracotta"
                />
                <span className="text-[13px] text-espresso">{col.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
