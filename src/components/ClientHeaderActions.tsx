"use client";

import { useState } from "react";
import NotificationBell from "@/components/NotificationBell";
import ReportIssueModal, { BugIcon } from "@/components/ReportIssueModal";

export default function ClientHeaderActions() {
  const [showReportModal, setShowReportModal] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setShowReportModal(true)}
        title="Report a bug or request a feature"
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-terracotta/30 bg-terracotta-soft px-3 py-1.5 text-[11px] font-semibold text-terracotta transition-colors hover:bg-terracotta hover:text-white"
      >
        <BugIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Report Bug / Idea</span>
      </button>
      <NotificationBell />
      <ReportIssueModal open={showReportModal} onClose={() => setShowReportModal(false)} />
    </div>
  );
}
