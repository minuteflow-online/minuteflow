"use client";

import { useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

// Reusable collapsible form section — header is a real <button> for
// accessibility, chevron rotates open/closed. Used to break long task forms
// (TaskEditor) into named, independently-collapsible groups.
export default function Section({ title, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-sand bg-white">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-cream"
      >
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">{title}</h3>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-bark transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="space-y-3 border-t border-sand p-4">{children}</div>}
    </div>
  );
}
