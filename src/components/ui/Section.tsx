"use client";

import { useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  // Controlled mode (optional) — pass both to let a parent coordinate several
  // Sections as an accordion (only one open at a time). Omit both to keep the
  // original uncontrolled behavior, where each Section tracks its own state
  // and several can be open independently.
  open?: boolean;
  onToggle?: () => void;
}

// Reusable collapsible form section — header is a real <button> for
// accessibility, chevron rotates open/closed. Used to break long task forms
// (TaskEditor) into named, independently-collapsible groups.
export default function Section({ title, defaultOpen = false, children, open: controlledOpen, onToggle }: SectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const handleToggle = isControlled ? onToggle! : () => setInternalOpen((prev) => !prev);

  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors ${
          open ? "bg-terracotta-soft hover:bg-terracotta-soft" : "bg-parchment hover:bg-cream"
        }`}
      >
        <h3 className="text-xs font-bold text-terracotta uppercase tracking-wider">{title}</h3>
        <svg
          className={`h-4 w-4 shrink-0 text-terracotta transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="space-y-3 border-t border-sand p-4">{children}</div>}
    </div>
  );
}
