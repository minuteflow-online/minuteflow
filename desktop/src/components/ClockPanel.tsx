// Timer + Clock In/Break/Clock Out. Visual language lifted from
// SessionBanner.tsx (dot + state colors, timer typography, button classes) —
// laid out to match the wireframe's top-left panel (big centered timer,
// Clock In button beneath) rather than SessionBanner's own horizontal strip.
import { useEffect, useState } from "react";

export type ClockState = "idle" | "clocked-in" | "on-break";

interface ClockPanelProps {
  state: ClockState;
  clockInTime: string | null;
  actionPending: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onStartBreak: () => void;
  onEndBreak: () => void;
}

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function ClockPanel({
  state,
  clockInTime,
  actionPending,
  onClockIn,
  onClockOut,
  onStartBreak,
  onEndBreak,
}: ClockPanelProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state === "idle" || !clockInTime) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(clockInTime).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, clockInTime]);

  const dotClass =
    state === "clocked-in"
      ? "bg-sage shadow-[0_0_0_3px_rgba(107,143,113,0.2)] animate-breathe"
      : state === "on-break"
        ? "bg-amber animate-breathe"
        : "bg-clay";

  const label = state === "clocked-in" ? "Clocked In" : state === "on-break" ? "On Break" : "Ready to Start";

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">{label}</h3>
      </div>

      <div className="py-2 text-center">
        <div
          className="font-serif text-[40px] font-normal tracking-tight tabular-nums"
          style={{ color: state === "on-break" ? "var(--color-amber)" : "var(--color-sage)" }}
        >
          {formatTimer(elapsed)}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {state === "idle" && (
          <button
            onClick={onClockIn}
            disabled={actionPending}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold cursor-pointer transition-colors hover:bg-sage/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            Clock In
          </button>
        )}
        {state === "clocked-in" && (
          <>
            <button
              onClick={onStartBreak}
              disabled={actionPending}
              className="px-3 py-1.5 rounded-lg bg-amber-soft text-amber text-[12px] font-semibold cursor-pointer transition-colors hover:bg-amber-soft/70 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Break
            </button>
            <button
              onClick={onClockOut}
              disabled={actionPending}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clock Out
            </button>
          </>
        )}
        {state === "on-break" && (
          <button
            onClick={onEndBreak}
            disabled={actionPending}
            className="px-3 py-1.5 rounded-lg bg-sage text-white text-[12px] font-semibold cursor-pointer transition-colors hover:bg-sage/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            End Break
          </button>
        )}
      </div>
    </div>
  );
}
