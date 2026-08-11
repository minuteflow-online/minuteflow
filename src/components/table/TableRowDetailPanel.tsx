"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

// The 520px slide-over "full record" panel — previously reimplemented inline
// in FixedPayTasksPanel, FixedPayTasksTab, TaskAssignmentsAdminTab, and
// task-list/page.tsx. Now there's one shell; each table still supplies its
// own field content as children, since those differ per table.
export default function TableRowDetailPanel({ title, subtitle, onClose, children, footer }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-stretch">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="flex w-[520px] max-w-full flex-col overflow-hidden border-l border-sand bg-white shadow-2xl">
        <div className="shrink-0 flex items-center justify-between border-b border-sand px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded text-stone transition-colors hover:bg-sand/50 hover:text-espresso"
              aria-label="Close panel"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <span className="block text-[13px] font-semibold text-walnut">{title}</span>
              {subtitle && <span className="block text-[11px] text-stone">{subtitle}</span>}
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-sand px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
