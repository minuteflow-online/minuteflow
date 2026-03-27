"use client";

import type { TimeLog } from "@/types/database";

interface LiveSessionPromptProps {
  liveSession: TimeLog;
  onRejoin: () => void;
  onStartNew: () => void;
  onCancel: () => void;
}

function formatElapsed(startTime: string): string {
  const ms = Date.now() - new Date(startTime).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function LiveSessionPrompt({
  liveSession,
  onRejoin,
  onStartNew,
  onCancel,
}: LiveSessionPromptProps) {
  const elapsed = formatElapsed(liveSession.start_time);
  const meta = [liveSession.account, liveSession.client_name]
    .filter(Boolean)
    .join(" \u00B7 ");

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-sand shadow-xl w-full max-w-md mx-4">
        <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
          <h3 className="text-sm font-bold text-espresso">Live Session Found</h3>
          <button
            onClick={onCancel}
            className="text-bark hover:text-terracotta text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>
        <div className="p-5">
          {/* Live session info */}
          <div className="mb-5 p-4 rounded-lg bg-cream border border-sand">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-[7px] h-[7px] rounded-full bg-sage animate-pulse" />
              <span className="text-[11px] font-semibold text-sage uppercase tracking-wide">
                Live
              </span>
            </div>
            <p className="text-[15px] font-bold text-espresso mb-1">
              {liveSession.task_name}
            </p>
            {meta && (
              <p className="text-xs text-bark mb-1">{meta}</p>
            )}
            <p className="text-xs text-stone">
              Started {elapsed} ago
            </p>
          </div>

          <p className="text-[13px] text-bark mb-5">
            You have an active task running. Would you like to rejoin it or close it and start a new task?
          </p>

          <div className="flex gap-3">
            <button
              onClick={onStartNew}
              className="flex-1 py-2.5 rounded-lg bg-parchment text-walnut border border-sand text-[13px] font-semibold cursor-pointer transition-all hover:bg-sand hover:text-espresso"
            >
              Start New Task
            </button>
            <button
              onClick={onRejoin}
              className="flex-1 py-2.5 rounded-lg bg-terracotta text-white text-[13px] font-semibold cursor-pointer transition-all hover:bg-[#a85840]"
            >
              Rejoin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
