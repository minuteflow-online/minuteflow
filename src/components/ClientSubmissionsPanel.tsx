"use client";

import { useCallback, useEffect, useState } from "react";

type EntryType = "instruction" | "submission" | "revision" | "approval" | "comment" | string;

interface Entry {
  id: number;
  assigned_task_id: number;
  user_id: string | null;
  message_type: EntryType;
  content: string;
  submission_link: string | null;
  created_at: string;
  profiles: { id: string; full_name: string } | null;
}

interface TaskWithEntries {
  id: number;
  task_name: string;
  task_detail: string | null;
  category: string | null;
  status: string;
  due_date: string | null;
  assignees: { va_id: string; status: string; profiles: { id: string; full_name: string } | null }[];
  entries: Entry[];
}

const TYPE_LABEL: Record<string, string> = {
  instruction: "Instruction",
  submission: "Submission",
  revision: "Revision requested",
  approval: "Approved",
  comment: "Note",
};

const TYPE_BADGE: Record<string, string> = {
  instruction: "bg-slate-blue-soft text-slate-blue border-slate-blue/20",
  submission: "bg-sky-50 text-sky-600 border-sky-200",
  revision: "bg-amber-50 text-amber-600 border-amber-200",
  approval: "bg-emerald-50 text-emerald-600 border-emerald-200",
  comment: "bg-stone/10 text-stone border-stone/20",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-stone/10 text-stone border-stone/20",
  on_queue: "bg-stone/10 text-stone border-stone/20",
  in_progress: "bg-amber-50 text-amber-500 border-amber-200",
  submitted: "bg-sky-50 text-sky-600 border-sky-200",
  reviewing: "bg-violet-50 text-violet-600 border-violet-200",
  revision_needed: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  completed: "bg-sage-soft text-sage border-sage/20",
  paid: "bg-purple-50 text-purple-600 border-purple-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
  unassigned: "bg-stone/10 text-stone border-stone/20",
};

export default function ClientSubmissionsPanel({ refreshKey }: { refreshKey: number }) {
  const [tasks, setTasks] = useState<TaskWithEntries[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/client-admin/submissions");
    if (!res.ok) return;
    const data = await res.json();
    setTasks(data.tasks ?? []);
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData, refreshKey]);

  const review = async (taskId: number, action: "approve" | "revision") => {
    if (action === "revision") {
      const note = prompt("What needs to change? (optional)") ?? "";
      setActing(taskId);
      await fetch("/api/client-admin/submissions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action, note }),
      });
    } else {
      setActing(taskId);
      await fetch("/api/client-admin/submissions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action }),
      });
    }
    setActing(null);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No tasks assigned yet</p>
        <p className="mt-1 text-xs text-stone">Assign a task above to start seeing submissions here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const canReview = task.status === "submitted" || task.status === "reviewing";
        const assigneeNames = task.assignees.map((a) => a.profiles?.full_name).filter(Boolean).join(", ");
        return (
          <div key={task.id} className="rounded-xl border border-sand bg-white p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[13px] font-semibold text-espresso">{task.task_name}</span>
                {assigneeNames && <span className="ml-2 text-[11px] text-stone">— {assigneeNames}</span>}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_BADGE[task.status] ?? STATUS_BADGE.pending}`}>
                {task.status.replace(/_/g, " ")}
              </span>
            </div>

            {task.entries.length > 0 && (
              <div className="space-y-1.5 border-t border-parchment pt-2">
                {task.entries.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 text-[12px]">
                    <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-[1px] rounded-full border ${TYPE_BADGE[e.message_type] ?? TYPE_BADGE.comment}`}>
                      {TYPE_LABEL[e.message_type] ?? e.message_type}
                    </span>
                    <span className="text-espresso">{e.content}</span>
                    {e.submission_link && (
                      <a href={e.submission_link} target="_blank" rel="noreferrer" className="text-slate-blue hover:underline">
                        link
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canReview && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => review(task.id, "approve")}
                  disabled={acting === task.id}
                  className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => review(task.id, "revision")}
                  disabled={acting === task.id}
                  className="px-3 py-1 rounded-lg bg-amber text-white text-[11px] font-semibold hover:bg-amber/90 transition-colors disabled:opacity-50"
                >
                  Request Revision
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
