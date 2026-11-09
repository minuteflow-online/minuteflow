"use client";

/**
 * The full-size screenshot viewer — Admin's Screenshot Report viewer, shared.
 *
 * Header: who took it, the task, the capture type and when it was taken.
 * Body: the image, or the reason there isn't one. Footer: task, account,
 * client, category. Admin renders this directly; every other page reaches it
 * through ScreenshotLightbox, which looks the details up. One component, so a
 * change to the Admin viewer shows up everywhere screenshots are opened
 * (Toni's call, 2026-11-09).
 */
import { useEffect } from "react";
import { getAvatarColor, getInitials } from "@/lib/utils";
import {
  exactCaptureTime,
  formatCaptureDate,
  formatCaptureTime,
  isMarkerShot,
  screenshotTypeBadge,
  screenshotTypeLabel,
  type ReportShot,
} from "@/lib/screenshotReport";

export type ViewerPerson = { id: string; full_name: string | null };
export type ViewerLog = {
  task_name: string | null;
  account: string | null;
  client_name: string | null;
  category: string | null;
};

export default function ScreenshotViewerFrame({
  screenshot,
  url,
  person,
  log,
  timezone,
  caption,
  position,
  onClose,
  onPrev,
  onNext,
}: {
  /** The screenshot row. Null for a plain image (an attachment, a bug-report
   *  capture) — then only the image, caption and position are shown. */
  screenshot: ReportShot | null;
  url: string | null;
  person: ViewerPerson | null;
  log: ViewerLog | null;
  timezone?: string;
  caption?: string;
  /** "3 / 12" — shown when there's more than one to walk through. */
  position?: { index: number; count: number };
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext]);

  const badge = screenshot ? screenshotTypeBadge(screenshot.screenshot_type) : null;
  const isMarker = screenshot ? isMarkerShot(screenshot) : false;
  // captured_at is the client's own stamp from the moment of capture; the filename
  // is the next best thing; created_at is when the row landed, which for a queued
  // upload can be hours later. Kept on hover either way for support questions.
  const exactCapture = screenshot ? exactCaptureTime(screenshot) : null;
  const capturedAt = screenshot ? exactCapture ?? screenshot.created_at : null;
  const showPosition = position && position.count > 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-6 border-b border-parchment px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {person && (
              <>
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: getAvatarColor(person.id) }}
                >
                  {getInitials(person.full_name ?? "")}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-espresso">{person.full_name}</div>
                  {log?.task_name && <div className="truncate text-[11px] text-bark">{log.task_name}</div>}
                </div>
              </>
            )}
            {screenshot && badge && (
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                {screenshotTypeLabel(screenshot.screenshot_type)}
              </span>
            )}
            {!screenshot && caption && <span className="truncate text-[12px] text-bark">{caption}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {showPosition && (
              <span className="text-[11px] tabular-nums text-stone">
                {position.index + 1} / {position.count}
              </span>
            )}
            {screenshot && capturedAt && (
              <span
                className="text-[11px] text-stone"
                title={`Uploaded ${formatCaptureDate(screenshot.created_at, timezone)} at ${formatCaptureTime(
                  screenshot.created_at,
                  timezone
                )}${screenshot.filename ? ` · ${screenshot.filename}` : ""}`}
              >
                {exactCapture ? "Taken" : "Uploaded"} {formatCaptureDate(capturedAt, timezone)} at{" "}
                {formatCaptureTime(capturedAt, timezone)}
              </span>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-bark transition-colors hover:bg-parchment hover:text-espresso"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Image, or the reason there isn't one */}
        <div className="flex-1 overflow-auto bg-espresso p-2">
          {isMarker && screenshot ? (
            // A marker has no image and never will, so waiting on one says
            // "Loading image…" forever. Arrow keys still walk onto these, so the
            // viewer has to state the reason rather than sit blank.
            <div className="flex h-96 flex-col items-center justify-center gap-2 text-center">
              <span className="text-3xl text-stone">&#8709;</span>
              <span className="text-sm font-medium text-parchment">
                {screenshot.failure_reason || "No screenshot was taken"}
              </span>
              <span className="text-xs text-stone">Nothing was captured for this slot.</span>
            </div>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Screenshot full view" className="mx-auto max-h-[75vh] rounded object-contain" />
          ) : (
            <div className="flex h-96 items-center justify-center text-sm text-stone">Loading image...</div>
          )}
        </div>

        {/* Navigation arrows */}
        {onPrev && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-espresso shadow-lg transition-all hover:bg-white"
            aria-label="Previous screenshot"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {onNext && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-espresso shadow-lg transition-all hover:bg-white"
            aria-label="Next screenshot"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Footer with details */}
        {log && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-parchment px-5 py-3 text-[11px] text-bark">
            {log.task_name && (
              <span>
                <strong className="text-espresso">Task:</strong> {log.task_name}
              </span>
            )}
            {log.account && (
              <span>
                <strong className="text-espresso">Account:</strong> {log.account}
              </span>
            )}
            {log.client_name && (
              <span>
                <strong className="text-espresso">Client:</strong> {log.client_name}
              </span>
            )}
            {log.category && (
              <span>
                <strong className="text-espresso">Category:</strong> {log.category}
              </span>
            )}
          </div>
        )}
        {screenshot && caption && (
          <div className="border-t border-parchment px-5 py-2 text-[11px] text-stone">{caption}</div>
        )}
      </div>
    </div>
  );
}
