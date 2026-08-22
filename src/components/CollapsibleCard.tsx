"use client";

import { useState, type ReactNode } from "react";

// Same behaviour as ui/Section (header button, rotating chevron) wearing the
// profile pages' card chrome instead of TaskEditor's terracotta accordion —
// these sit among cards that are not collapsible, so the header has to keep
// reading as one of them.
export default function CollapsibleCard({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Shown beside the title while closed — what the section says at a glance. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-cream transition-colors"
      >
        <h3 className="text-[10px] font-bold text-espresso uppercase tracking-wide">{title}</h3>
        <span className="flex items-center gap-2">
          {summary && <span className="text-[10px] font-semibold text-walnut">{summary}</span>}
          <svg
            className={`h-3.5 w-3.5 text-bark transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && <div className="border-t border-sand p-4">{children}</div>}
    </div>
  );
}
