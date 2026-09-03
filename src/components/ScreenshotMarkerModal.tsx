"use client";

// The marker's equivalent of ScreenshotLightbox — a marker has no image to
// enlarge, so clicking one used to do nothing at all (the same dead click a
// still-loading real screenshot gets). This gives it something to show:
// the actual reason, in the open, not just a hover tooltip that a touch
// device can't trigger and a reviewer might never notice to hover over.

import type { TaskScreenshot } from "@/types/database";

export default function ScreenshotMarkerModal({
  screenshot,
  onClose,
}: {
  screenshot: TaskScreenshot;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-sand bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-soft">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-amber" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M2 11l3.5-3.5a1 1 0 0 1 1.4 0L9 9.5" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h2 className="font-serif text-lg font-bold text-espresso">No screenshot for this slot</h2>
            <p className="mt-1 text-sm text-stone">{screenshot.failure_reason || "No reason recorded."}</p>
          </div>
        </div>
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-stone/10 px-4 py-2.5 text-[13px] font-semibold text-stone transition-colors hover:bg-stone/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
