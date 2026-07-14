"use client";

import { useEffect, useState } from "react";
import type { ActiveTask } from "@/types/database";

interface ActiveTaskBarProps {
  task: ActiveTask;
  startTime: string;
  onScreenshot: () => void;
  onNotes: () => void;
  onReshare?: () => void;
}

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function secondsSince(startTime: string): number {
  return Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
}

export default function ActiveTaskBar({
  task,
  startTime,
  onScreenshot,
  onNotes,
  onReshare,
}: ActiveTaskBarProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => secondsSince(startTime));

  useEffect(() => {
    setElapsedSeconds(secondsSince(startTime));
    const interval = setInterval(() => {
      setElapsedSeconds(secondsSince(startTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const details = [task.project, task.account, task.client_name]
    .filter(Boolean)
    .join(" \u00B7 ");

  return (
    <div className="bg-white border border-[#b5ceb8] border-l-[3px] border-l-sage rounded-[10px] py-3.5 px-5 mb-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3.5">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[1.2px] text-sage bg-sage-soft py-[3px] px-2.5 rounded">
          <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
          Active
        </span>
        <div>
          <div className="text-[15px] font-semibold text-espresso">
            {task.task_name}
          </div>
          {details && (
            <div className="text-xs text-bark mt-px">{details}</div>
          )}
        </div>
      </div>

      <div className="font-serif text-[22px] text-sage tabular-nums">
        {formatTimer(elapsedSeconds)}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onNotes}
          className="inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg bg-parchment text-walnut border border-sand text-xs font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
        >
          Notes
        </button>
        {onReshare && (
          <button
            onClick={onReshare}
            className="inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg bg-parchment text-walnut border border-sand text-xs font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
            Reshare Screen
          </button>
        )}
        <button
          onClick={onScreenshot}
          className="inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg bg-terracotta text-white text-xs font-semibold cursor-pointer transition-all hover:bg-[#a85840]"
        >
          Screenshot
        </button>
      </div>
    </div>
  );
}
