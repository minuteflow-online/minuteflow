"use client";

import { useCallback, useEffect, useState } from "react";
import type { FixedPayTaskWithClaimer, VAAssignedTask } from "@/types/database";

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
  const [pendingAssigned, setPendingAssigned] = useState<VAAssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fixedRes, assignedRes] = await Promise.all([
        fetch("/api/fixed-pay-tasks", { cache: "no-store" }),
        fetch("/api/assigned-tasks?status=pending", { cache: "no-store" }),
      ]);

      if (!fixedRes.ok) throw new Error(`HTTP ${fixedRes.status}`);
      const fixedJson = await fixedRes.json();
      const fixedRows = Array.isArray(fixedJson) ? fixedJson : fixedJson.tasks ?? [];
      setTasks(fixedRows as FixedPayTaskWithClaimer[]);

      if (assignedRes.ok) {
        const assignedJson = await assignedRes.json();
        const assignedRows = assignedJson.tasks ?? [];
        setPendingAssigned(assignedRows as VAAssignedTask[]);
      }
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

  const handleAccept = useCallback(
    async (task: VAAssignedTask) => {
      const assigneeId = String(task.id);
      setAcceptingId(assigneeId);
      setError(null);
      try {
        const res = await fetch(`/api/assigned-tasks/${task.assigned_tasks.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "on_queue" }),
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
        // Remove from pending list optimistically
        setPendingAssigned((prev) => prev.filter((t) => t.id !== task.id));
        onClaimed?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to accept task.");
      } finally {
        setAcceptingId(null);
      }
    },
    [onClaimed]
  );

  const openTasks = tasks.filter((t) => !t.claimed_by_me);
  const totalCount = pendingAssigned.length + openTasks.length;

  return (
    <div className="rounded-xl border border-sand bg-white p-3 space-y-2 max-h-[75vh] overflow-y-auto">
      <h3 className="text-xs font-bold text-espresso uppercase tracking-wide flex items-center gap-1.5 sticky top-0 bg-white pb-1 z-10">
        <svg className="h-3.5 w-3.5 text-terracotta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        Available Tasks
        <span className="text-stone font-normal normal-case">({totalCount})</span>
      </h3>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-stone text-[11px] text-center py-3">Loading...</p>
      ) : totalCount === 0 ? (
        <p className="text-stone text-[11px] text-center py-3 italic">No available tasks right now.</p>
      ) : (
        <div className="space-y-1.5">
          {/* Pending assigned tasks (admin-assigned, awaiting acceptance) */}
          {pendingAssigned.map((task) => {
            const assigneeId = String(task.id);
            const isAccepting = acceptingId === assigneeId;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rate = (task.assigned_tasks as any)?.fixed_pay_tasks?.rate;
            return (
              <div key={`assigned-${task.id}`} className="rounded-lg border border-sand overflow-hidden">
                <div className="px-2.5 py-2 bg-parchment/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-espresso truncate">{task.assigned_tasks.task_name}</span>
                    {rate != null && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                        ${Number(rate).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {task.assigned_tasks.account ?? ""}
                    {task.assigned_tasks.project ? ` / ${task.assigned_tasks.project}` : ""}
                  </div>
                </div>
                <div className="px-2.5 py-2.5 bg-parchment/10">
                  <button
                    onClick={() => void handleAccept(task)}
                    disabled={isAccepting}
                    className="w-full px-3 py-2 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {isAccepting ? "Accepting..." : "Accept"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Fixed-pay tasks available to grab */}
          {openTasks.map((task) => {
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
