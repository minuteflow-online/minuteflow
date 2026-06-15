"use client";

import { useCallback, useEffect, useState } from "react";
import type { FixedPayTaskWithClaimer } from "@/types/database";

function formatClaimedAt(claimedAt: string | null) {
  if (!claimedAt) return "";
  const date = new Date(claimedAt);
  if (Number.isNaN(date.getTime())) return claimedAt;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AvailableTasksWidget({
  onClaimed,
}: {
  onClaimed?: () => void;
}) {
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fixed-pay-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json) ? json : json.tasks ?? [];
      setTasks(rows as FixedPayTaskWithClaimer[]);
    } catch {
      setError("Unable to load available tasks right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleClaim = useCallback(
    async (taskId: string) => {
      setClaimingId(taskId);
      setError(null);
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${taskId}/grab`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // ignore parse failures
          }
          throw new Error(message);
        }
        await fetchTasks();
        onClaimed?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to claim task.");
      } finally {
        setClaimingId(null);
      }
    },
    [fetchTasks, onClaimed]
  );

  return (
    <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5 sticky top-0 bg-white pb-1 z-10">
        <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        Available Tasks
        <span className="text-stone font-normal normal-case">({tasks.length})</span>
      </h3>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-stone text-[11px] text-center py-3">Loading...</p>
      ) : tasks.length === 0 ? (
        <p className="text-stone text-[11px] text-center py-3 italic">No available tasks right now.</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => {
            const isClaiming = claimingId === task.id;
            return (
              <div key={task.id} className="rounded-lg border border-sand overflow-hidden">
                <div className="px-2.5 py-2 bg-parchment/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-espresso truncate">{task.task_name}</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                      ${Number(task.rate).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {task.account ?? ""}
                    {task.category ? ` / ${task.category}` : ""}
                  </div>
                </div>

                <div className="px-2.5 py-2.5 bg-parchment/10 space-y-2">
                  <div className="text-[11px] text-stone">
                    {task.claimed_at ? (
                      <span>Claimed {formatClaimedAt(task.claimed_at)}</span>
                    ) : (
                      <span>Unclaimed</span>
                    )}
                  </div>
                  <button
                    onClick={() => void handleClaim(task.id)}
                    disabled={isClaiming}
                    className="w-full px-3 py-2 rounded-lg bg-terracotta text-white text-[11px] font-semibold hover:bg-[#c4573a] disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {isClaiming ? "Claiming..." : "Grab This Task"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
