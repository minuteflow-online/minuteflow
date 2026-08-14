"use client";

import { useState } from "react";

// A standalone multi-select filter button for the toolbar above a table —
// for filters that shouldn't also take up a table column (e.g. "which
// project is this task under" is useful to filter by without needing its
// own always-visible column). Extracted from the inline copy already used
// on the Assignment page's Time-based table.
export default function ToolbarFilterDropdown({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const isFiltered = selected.length > 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
          isFiltered ? "border-terracotta text-terracotta" : "border-sand text-stone hover:text-walnut"
        }`}
      >
        {label}
        {isFiltered && <span className="rounded-full bg-terracotta/10 px-1.5 text-[10px] font-semibold">{selected.length}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 max-h-72 min-w-[200px] overflow-y-auto rounded-xl border border-sand bg-white py-1 shadow-lg">
            <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
              <button type="button" onClick={() => onChange(options)} className="text-[11px] text-terracotta hover:underline">Select All</button>
              <button type="button" onClick={() => onChange([])} className="text-[11px] text-stone hover:underline">Clear</button>
            </div>
            {options.length > 0 ? (
              options.map((opt) => (
                <label key={opt} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-parchment">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={(e) => {
                      if (e.target.checked) onChange([...selected, opt]);
                      else onChange(selected.filter((v) => v !== opt));
                    }}
                    className="accent-terracotta"
                  />
                  <span className="text-[13px] text-espresso">{opt}</span>
                </label>
              ))
            ) : (
              <div className="px-3 py-2 text-[12px] text-stone">No options</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
