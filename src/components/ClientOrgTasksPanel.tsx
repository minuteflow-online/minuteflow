"use client";

import { useCallback, useEffect, useState } from "react";

type OrgTask = {
  id: number;
  taskName: string;
  category: string | null;
  status: string | null;
  dueDate: string | null;
  plannedMinutes: number | null;
  reviewRequired: boolean;
  archived: boolean;
  assignees: string[];
};

// Same colours as AssignedTasksWidget's status badges.
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-stone/10 text-stone border-stone/20" },
  on_queue: { label: "On Queue", className: "bg-stone/10 text-stone border-stone/20" },
  in_progress: { label: "In Progress", className: "bg-amber-50 text-amber-500 border-amber-200" },
  submitted: { label: "Submitted", className: "bg-sky-50 text-sky-600 border-sky-200" },
  reviewing: { label: "Reviewing", className: "bg-violet-50 text-violet-600 border-violet-200" },
  revision_needed: { label: "Revision Needed", className: "bg-amber-50 text-amber-600 border-amber-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  completed: { label: "Completed", className: "bg-sage-soft text-sage border-sage/20" },
  paid: { label: "Paid", className: "bg-purple-50 text-purple-600 border-purple-200" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-500 border-red-200" },
};

function dueLabel(date: string | null): string {
  if (!date) return "No due date";
  return `Due ${new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * Every task the client's org assigned, with the one setting the client may
 * change at any time — Review Required — even after it has locked.
 */
export default function ClientOrgTasksPanel() {
  const [tasks, setTasks] = useState<OrgTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/client-admin/tasks", { cache: "no-store" });
    if (res.ok) setTasks(((await res.json()) as { tasks: OrgTask[] }).tasks ?? []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const setReview = async (task: OrgTask, value: boolean) => {
    setBusyId(task.id);
    setError(null);
    // Optimistic — put it back if the server says no.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, reviewRequired: value } : t)));
    try {
      const res = await fetch(`/api/client-admin/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_required: value }),
      });
      if (!res.ok) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, reviewRequired: !value } : t)));
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't change it.");
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  const visible = tasks.filter((t) => showArchived || !t.archived);

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Your Team&apos;s Tasks</h3>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            showArchived ? "bg-sage text-white hover:bg-sage/90" : "bg-stone/10 text-stone hover:bg-stone/20"
          }`}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>
      <p className="text-[11px] text-stone/80">
        Review Required decides whether a submission waits for your approval or closes when the VA submits. You can
        change it on any of your tasks.
      </p>
      {error && <p className="text-[11px] text-terracotta">{error}</p>}

      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-stone">No tasks yet. Assign one from the Dashboard.</p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((t) => {
            const badge = t.status ? STATUS_BADGE[t.status] : null;
            return (
              <div key={t.id} className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-espresso leading-tight">{t.taskName}</span>
                  {badge && (
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-[2px] rounded-full border ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-stone/80">
                    {[
                      t.assignees.join(", ") || "Unassigned",
                      t.category,
                      dueLabel(t.dueDate),
                      t.plannedMinutes ? `${Math.round((t.plannedMinutes / 60) * 100) / 100} h planned` : null,
                      t.archived ? "Archived" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-espresso">
                    <input
                      type="checkbox"
                      checked={t.reviewRequired}
                      disabled={busyId === t.id}
                      onChange={(e) => setReview(t, e.target.checked)}
                      className="accent-sage"
                    />
                    Review required
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
