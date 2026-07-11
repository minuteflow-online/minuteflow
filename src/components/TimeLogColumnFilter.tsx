"use client";

import { useEffect, useRef, useState } from "react";

function FunnelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16l-6.5 8v6l-3 2v-8L4 4Z" />
    </svg>
  );
}

export default function TimeLogColumnFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = selected.size > 0;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const toggleValue = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <div className="relative inline-block" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded transition-colors ${
          isActive ? "text-terracotta" : "text-stone hover:text-walnut"
        }`}
        title={`Filter ${label}`}
      >
        <FunnelIcon className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-5 z-20 w-52 rounded-lg border border-sand bg-white p-2 shadow-lg normal-case tracking-normal">
          <label className="flex items-center gap-2 rounded px-2 py-1 text-[12px] font-semibold text-espresso hover:bg-parchment cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === 0}
              onChange={() => onChange(new Set())}
              className="cursor-pointer accent-terracotta"
            />
            All
          </label>
          <div className="my-1 border-t border-parchment" />
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-stone">No values</p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 rounded px-2 py-1 text-[12px] text-espresso hover:bg-parchment cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt)}
                    onChange={() => toggleValue(opt)}
                    className="cursor-pointer accent-terracotta"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
