"use client";

import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * A labelled dropdown of checkboxes, for filters where more than one value can
 * apply at once ("show me these three accounts").
 *
 * An empty selection means "all" — the same convention TimeLogColumnFilter
 * uses, so an untouched filter never hides anything.
 */
export default function MultiSelectFilter({
  allLabel,
  options,
  selected,
  onChange,
}: {
  /** Shown on the button when nothing is selected, e.g. "All accounts". */
  allLabel: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  // One selection reads better as its own name than as "1 selected".
  const buttonLabel =
    selected.size === 0
      ? allLabel
      : selected.size === 1
        ? (options.find((o) => o.value === Array.from(selected)[0])?.label ?? allLabel)
        : `${selected.size} selected`;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] outline-none transition-colors ${
          selected.size > 0
            ? "border-terracotta/40 bg-terracotta-soft text-terracotta font-semibold"
            : "border-sand bg-white text-espresso"
        }`}
      >
        <span className="max-w-[140px] truncate">{buttonLabel}</span>
        <svg width="8" height="8" viewBox="0 0 12 12" className="shrink-0 opacity-60">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-56 rounded-lg border border-sand bg-white p-2 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] font-semibold text-espresso hover:bg-parchment">
            <input
              type="checkbox"
              checked={selected.size === 0}
              onChange={() => onChange(new Set())}
              className="cursor-pointer accent-terracotta"
            />
            {allLabel}
          </label>
          <div className="my-1 border-t border-parchment" />
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-stone">No values</p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-espresso hover:bg-parchment"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="cursor-pointer accent-terracotta"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
