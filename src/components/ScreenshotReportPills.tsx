"use client";

/**
 * The Screenshot Report's pills — unchanged / away / no browser view runs, and
 * stretches with no capture record. Admin's Screenshots tab and the SC Data pill
 * on submissions both render these, so a change here shows up in both.
 */
import { useEffect, useRef, useState } from "react";
import { formatGapMinutes, type CaptureBatch } from "@/lib/screenshotGaps";
import { formatCaptureTime, type TaskShotSummary } from "@/lib/screenshotReport";

/**
 * One pill per state: how many captures and how long in total, opening onto
 * every run so each can be jumped to. Renders nothing when there are no runs.
 */
export function CaptureBatchPill({
  batches,
  noun,
  colorClass,
  title,
  orgTimezone,
  onJump,
}: {
  batches: CaptureBatch[];
  noun: string;
  colorClass: string;
  title: string;
  orgTimezone: string;
  /** Scroll to a run's first capture. Without it the runs are listed, not linked. */
  onJump?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (batches.length === 0) return null;
  const totalCount = batches.reduce((n, b) => n + b.count, 0);
  const totalMinutes = batches.reduce((n, b) => n + b.minutes, 0);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={`flex items-center gap-1 rounded-full border px-2 py-[1px] text-[9px] font-semibold ${colorClass}`}
      >
        {totalCount} {noun} · {formatGapMinutes(totalMinutes)}
        <svg className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-lg border border-sand bg-white p-1.5 shadow-xl">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-walnut">
            {batches.length} batch{batches.length !== 1 ? "es" : ""}
          </p>
          {batches.map((b, i) => (
            <button
              key={b.ids[0]}
              type="button"
              onClick={() => {
                onJump?.(b.ids[0]);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] text-espresso transition-colors hover:bg-cream"
            >
              <span className="text-bark">
                #{i + 1} · {formatCaptureTime(b.start, orgTimezone)} – {formatCaptureTime(b.end, orgTimezone)}
              </span>
              <span className="shrink-0 font-semibold">
                {b.count} · {formatGapMinutes(b.minutes)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The three state pills, inline, in the report's order. */
export function CaptureStatePills({
  summary,
  orgTimezone,
  onJump,
}: {
  summary: TaskShotSummary;
  orgTimezone: string;
  onJump?: (id: number) => void;
}) {
  return (
    <>
      <CaptureBatchPill
        batches={summary.unchangedBatches}
        noun="unchanged"
        colorClass="border-amber/20 bg-amber-soft text-amber"
        title="Screen identical to the capture before it. Each run is timed from that earlier capture to the last identical one."
        orgTimezone={orgTimezone}
        onJump={onJump}
      />
      <CaptureBatchPill
        batches={summary.awayBatches}
        noun="away"
        colorClass="border-stone/20 bg-stone/10 text-stone"
        title="Computer idle or screen locked. Each run is timed from its first capture to the capture that ended it."
        orgTimezone={orgTimezone}
        onJump={onJump}
      />
      <CaptureBatchPill
        batches={summary.notCapturedBatches}
        noun="no browser view"
        colorClass="border-sand bg-parchment text-bark"
        title="Nothing to capture in the browser — working in another app, or on a page the extension cannot read. Not a claim about the person. Each run is timed from its first capture to the capture that ended it."
        orgTimezone={orgTimezone}
        onJump={onJump}
      />
    </>
  );
}

/** Stretches with neither a screenshot nor a marker, one pill each. */
export function CaptureGapPills({
  summary,
  orgTimezone,
}: {
  summary: TaskShotSummary;
  orgTimezone: string;
}) {
  if (summary.gaps.length === 0) return null;
  return (
    <>
      {summary.gaps.map((gap) => (
        <span
          key={gap.start}
          className="rounded-full border border-amber/20 bg-amber-soft px-2 py-[1px] text-[9px] font-semibold text-amber"
          title="Neither a screenshot nor a reason was recorded for this stretch, so capture was not running or could not report (for example the capture extension was signed out or off, the browser or desktop app was closed, the computer was asleep, or screen sharing was not started). Not a claim about the person."
        >
          No capture record · {formatCaptureTime(gap.start, orgTimezone)} – {formatCaptureTime(gap.end, orgTimezone)} ({formatGapMinutes(gap.minutes)})
        </span>
      ))}
    </>
  );
}
