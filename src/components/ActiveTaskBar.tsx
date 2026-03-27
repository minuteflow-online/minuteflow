"use client";

import type { ActiveTask } from "@/types/database";

interface ActiveTaskBarProps {
  task: ActiveTask;
  elapsedSeconds: number;
  onScreenshot: () => void;
  onNotes: () => void;
}

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function ActiveTaskBar({
  task,
  elapsedSeconds,
  onScreenshot,
  onNotes,
}: ActiveTaskBarProps) {
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
