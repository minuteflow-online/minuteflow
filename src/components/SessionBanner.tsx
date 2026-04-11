"use client";

import { useCallback } from "react";

export type SessionState = "idle" | "clocked-in" | "on-break";

interface SessionBannerProps {
  state: SessionState;
  clockInTime: string | null;
  elapsedSeconds: number;
  breakElapsedSeconds: number;
  screenShareActive?: boolean;
  timezone?: string;
  onClockIn?: () => void;
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

function formatTime(iso: string, timezone?: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    timeZone: timezone || "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function SessionBanner({
  state,
  clockInTime,
  elapsedSeconds,
  breakElapsedSeconds,
  screenShareActive,
  timezone,
  onClockIn,
  onClockOut,
  onStartBreak,
  onEndBreak,
}: SessionBannerProps) {
  const bannerClass = useCallback(() => {
    switch (state) {
      case "clocked-in":
        return "bg-sage-soft border border-[#b5ceb8]";
      case "on-break":
        return "bg-amber-soft border border-[#d4c07a]";
      default:
        return "bg-parchment border border-dashed border-clay";
    }
  }, [state]);

  const dotClass = useCallback(() => {
    switch (state) {
      case "clocked-in":
        return "bg-sage shadow-[0_0_0_3px_rgba(107,143,113,0.2)] animate-breathe";
      case "on-break":
        return "bg-amber animate-breathe";
      default:
        return "bg-clay";
    }
  }, [state]);

  return (
    <div
      className={`rounded-[14px] p-[18px_24px] mb-6 flex items-center justify-between gap-4 flex-wrap ${bannerClass()}`}
    >
      <div className="flex items-center gap-3.5">
        <div
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass()}`}
        />
        <div>
          <h3 className="text-[15px] font-bold text-espresso">
            {state === "clocked-in"
              ? "Clocked In"
              : state === "on-break"
                ? "On Break"
                : "Ready to Start"}
          </h3>
          <p className="text-xs text-walnut mt-0.5">
            {state === "idle"
              ? "Fill in a task below and click Start Activity to begin"
              : state === "on-break"
                ? `Break started ${breakElapsedSeconds > 0 ? formatTimer(breakElapsedSeconds) + " ago" : "just now"}`
                : clockInTime
                  ? `Since ${formatTime(clockInTime, timezone)}`
                  : "Session active"}
          </p>
          {screenShareActive && state !== "idle" && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-sage bg-sage-soft px-2 py-0.5 rounded-full">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-sage">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
              </svg>
              Screen sharing
            </span>
          )}
        </div>
      </div>

      {state !== "idle" && (
        <div className="font-serif text-[30px] font-normal tracking-tight tabular-nums" style={{
          color: state === "on-break" ? "var(--color-amber)" : "var(--color-sage)",
        }}>
          {state === "on-break"
            ? formatTimer(breakElapsedSeconds)
            : formatTimer(elapsedSeconds)}
        </div>
      )}

      <div className="flex gap-2">
        {state === "idle" && onClockIn && (
          <button
            onClick={onClockIn}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-sage text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#5a8a60] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(107,143,113,0.25)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
            Clock In
          </button>
        )}
        {state === "clocked-in" && (
          <>
            <button
              onClick={onStartBreak}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-soft text-amber text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#ecdbb0]"
            >
              Break
            </button>
            <button
              onClick={onClockOut}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
            >
              Clock Out
            </button>
          </>
        )}
        {state === "on-break" && (
          <button
            onClick={onEndBreak}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(194,105,79,0.25)]"
          >
            End Break
          </button>
        )}
      </div>
    </div>
  );
}
