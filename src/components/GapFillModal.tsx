"use client";

import { useState } from "react";

const ACCOUNTS = [
  "TAT Foundation",
  "WSB Awesome Team",
  "Virtual Concierge",
  "Colina Portrait",
  "SNAPS Sublimation",
  "Thess Personal",
  "Thess Base",
  "Right Path Agency",
  "Personal",
  "Quad Life",
  "TONIWSB",
];

const CATEGORIES = [
  "Task",
  "Communication",
  "Planning",
  "Collaboration",
  "Personal",
  "Break",
];

interface GapFillModalProps {
  gapStart: string;
  orgTimezone: string;
  onSubmit: (taskName: string, account: string, category: string) => Promise<void>;
}

function formatTime(isoString: string, timezone: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}m`;
}

export default function GapFillModal({ gapStart, orgTimezone, onSubmit }: GapFillModalProps) {
  const [taskName, setTaskName] = useState("");
  const [account, setAccount] = useState("Virtual Concierge");
  const [category, setCategory] = useState("Task");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const gapStartFormatted = formatTime(gapStart, orgTimezone);
  const duration = formatDuration(gapStart);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!taskName.trim()) {
      setError("Task name is required.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(taskName.trim(), account, category);
    } catch {
      setError("Failed to log time. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-xl border border-sand bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-sand">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-terracotta mb-1">
            Action Required
          </div>
          <h2 className="font-serif text-xl font-bold text-espresso">
            You have untracked time
          </h2>
          <p className="mt-1 text-sm text-terracotta font-medium">
            Your last task ended at {gapStartFormatted}. You have been clocked
            in with no task running for {duration}. Log what you were working on
            to continue.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Read-only time range */}
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">
                Start Time
              </p>
              <div className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-stone bg-parchment">
                {gapStartFormatted}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">
                End Time
              </p>
              <div className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-stone bg-parchment">
                Now (at submission)
              </div>
            </div>
          </div>

          {/* Task Name */}
          <div>
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">
              Task Name <span className="text-terracotta">*</span>
            </p>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="What were you working on?"
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white focus:border-bark"
              autoFocus
            />
          </div>

          {/* Account */}
          <div>
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">
              Account
            </p>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white focus:border-bark"
            >
              {ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase mb-1">
              Category
            </p>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white focus:border-bark"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-terracotta font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-lg bg-sage text-white text-[13px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting ? "Logging…" : "Log Untracked Time"}
          </button>
        </form>
      </div>
    </div>
  );
}
