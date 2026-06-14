"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import type { AssignedTaskStatus } from "@/types/database";

type VATaskRow = {
  id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  assigned_at: string | null;
  updated_at: string | null;
  is_collaborative?: boolean;
  collaborator_name?: string | null;
  assigned_tasks: {
    id: number;
    account: string | null;
    project: string | null;
    task_name: string;
    task_detail: string | null;
    task_notes: string | null;
    due_date: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
};

const STATUS_FILTERS: Array<{ value: AssignedTaskStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "on_queue", label: "On Queue" },
  { value: "in_progress", label: "In Progress" },
  { value: "submitted", label: "Submitted" },
  { value: "reviewing", label: "Reviewing" },
  { value: "revision_needed", label: "Revision Needed" },
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_ORDER: Record<AssignedTaskStatus, number> = {
  on_queue: 0,
  in_progress: 1,
  submitted: 2,
  reviewing: 3,
  revision_needed: 4,
  approved: 5,
  completed: 6,
  paid: 7,
  cancelled: 8,
};

const STATUS_LABELS: Record<AssignedTaskStatus, string> = {
  on_queue: "On Queue",
  in_progress: "In Progress",
  submitted: "Submitted",
  reviewing: "Reviewing",
  revision_needed: "Revision Needed",
  approved: "Approved",
  completed: "Completed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_CLASSES: Record<AssignedTaskStatus, string> = {
  on_queue: "bg-stone/10 text-stone",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-sky-100 text-sky-700",
  reviewing: "bg-violet-100 text-violet-700",
  revision_needed: "bg-amber-100 text-amber-600",
  approved: "bg-emerald-100 text-emerald-700",
  completed: "bg-sage-soft text-sage",
  paid: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-500",
};

function StatusBadge({ status }: { status: AssignedTaskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return { label: "—", isOverdue: false };

  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return { label: dueDate, isOverdue: false };

  return {
    label: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    isOverdue: date.getTime() < Date.now(),
  };
}

function sortTasks(tasks: VATaskRow[]) {
  return [...tasks].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;

    const aTime = new Date(a.assigned_at ?? a.updated_at ?? a.assigned_tasks.created_at).getTime();
    const bTime = new Date(b.assigned_at ?? b.updated_at ?? b.assigned_tasks.created_at).getTime();
    return bTime - aTime;
  });
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<VATaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssignedTaskStatus | "all">("all");
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addTaskName, setAddTaskName] = useState("");
  const [addAccount, setAddAccount] = useState("");
  const [addProject, setAddProject] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assigned-tasks", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const raw = Array.isArray(json) ? json : json.tasks ?? [];
      const normalized = raw.map((row: VATaskRow) => ({
        ...row,
        is_collaborative: Boolean(row.is_collaborative),
        collaborator_name: row.collaborator_name ?? null,
      }));
      setTasks(sortTasks(normalized));
    } catch {
      setError("Unable to load assigned tasks right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = useMemo(
    () => (statusFilter === "all" ? tasks : tasks.filter((task) => task.status === statusFilter)),
    [tasks, statusFilter]
  );

  const refreshAndCloseDetail = useCallback(async () => {
    setExpandedId((prev) => prev);
    await fetchTasks();
  }, [fetchTasks]);

  const handleStatusChange = useCallback(
    async (task: VATaskRow, nextStatus: AssignedTaskStatus) => {
      if (task.is_collaborative) return;

      const taskId = task.assigned_tasks.id;
      const previousStatus = task.status;
      setSavingStatusId(task.id);
      setTasks((prev) =>
        sortTasks(
          prev.map((row) => (row.id === task.id ? { ...row, status: nextStatus } : row))
        )
      );

      try {
        const res = await fetch(`/api/assigned-tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        setTasks((prev) =>
          sortTasks(
            prev.map((row) => (row.id === task.id ? { ...row, status: previousStatus } : row))
          )
        );
      } finally {
        setSavingStatusId(null);
      }
    },
    []
  );

  const handleAddTask = useCallback(async () => {
    const taskName = addTaskName.trim();
    if (!taskName) {
      setAddError("Task name is required.");
      return;
    }

    setAddError(null);
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/assigned-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_name: taskName,
          account: addAccount.trim() || null,
          project: addProject.trim() || null,
          task_notes: addNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setAddOpen(false);
      setAddTaskName("");
      setAddAccount("");
      setAddProject("");
      setAddNotes("");
      await fetchTasks();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add task.");
    } finally {
      setAddSubmitting(false);
    }
  }, [addAccount, addNotes, addProject, addTaskName, fetchTasks]);

  const toggleExpanded = useCallback((id: number) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-2xl border border-sand bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-parchment px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold text-espresso">Tasks</h1>
            <p className="text-xs text-stone">Assigned work and collaborative tasks visible to you.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AssignedTaskStatus | "all")}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-xs text-espresso outline-none focus:border-terracotta"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#a85840]"
            >
              <span className="text-sm leading-none">+</span>
              Add Task
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] text-stone">
            <span className="rounded-full bg-parchment px-2 py-0.5 font-semibold text-walnut">
              {filteredTasks.length}
            </span>
            <span>task{filteredTasks.length === 1 ? "" : "s"}</span>
            {statusFilter !== "all" && (
              <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 font-semibold text-slate-blue">
                filtered by {STATUS_LABELS[statusFilter]}
              </span>
            )}
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-parchment" />
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sand px-4 py-10 text-center text-sm text-stone">
              No assigned tasks found.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-sand">
              <table className="min-w-full divide-y divide-parchment bg-white">
                <thead className="bg-cream/70">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-stone">
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3">Account / Project</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-parchment">
                  {filteredTasks.map((task) => {
                    const detail = task.assigned_tasks;
                    const isExpanded = expandedId === task.id;
                    const due = formatDueDate(detail.due_date);
                    const accountProject = [detail.account, detail.project].filter(Boolean).join(" · ");
                    const isSaving = savingStatusId === task.id;

                    return (
                      <Fragment key={task.id}>
                        <tr key={task.id} className="align-top hover:bg-cream/30">
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(task.id)}
                              className="flex items-start gap-2 text-left"
                            >
                              <span className={`mt-0.5 inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                                ›
                              </span>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-espresso">{detail.task_name}</span>
                                  {task.is_collaborative && task.collaborator_name && (
                                    <span className="rounded-full bg-slate-blue-soft px-2 py-0.5 text-[10px] font-semibold text-slate-blue">
                                      Collaborative with {task.collaborator_name}
                                    </span>
                                  )}
                                </div>
                                {detail.task_detail && !isExpanded && (
                                  <p className="mt-1 max-w-xl line-clamp-2 text-xs text-stone">
                                    {detail.task_detail}
                                  </p>
                                )}
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-4 text-xs text-walnut">
                            {accountProject || <span className="text-stone/60">—</span>}
                          </td>
                          <td className={`px-4 py-4 text-xs font-medium ${due.isOverdue ? "text-terracotta" : "text-walnut"}`}>
                            {due.isOverdue ? "Overdue · " : ""}
                            {due.label}
                          </td>
                          <td className="px-4 py-4">
                            <StatusBadge status={task.status} />
                          </td>
                          <td className="px-4 py-4">
                            {task.is_collaborative && (
                              <span className="text-[11px] text-stone">Read only</span>
                            )}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr key={`detail-${task.id}`}>
                            <td colSpan={5} className="bg-parchment/20 px-4 py-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-3">
                                  <div>
                                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone">
                                      Task detail
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm text-espresso">
                                      {detail.task_detail || <span className="text-stone/60">No detail provided.</span>}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone">
                                      Task notes
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm text-espresso">
                                      {detail.task_notes || <span className="text-stone/60">No notes provided.</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-3 rounded-xl border border-sand bg-white p-4">
                                  <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-stone">Due date</div>
                                    <div className={`mt-1 text-sm font-medium ${due.isOverdue ? "text-terracotta" : "text-espresso"}`}>
                                      {due.label}
                                      {due.isOverdue && detail.due_date ? " · Overdue" : ""}
                                    </div>
                                  </div>

                                  {task.is_collaborative ? (
                                    <div className="rounded-lg border border-slate-blue/20 bg-slate-blue-soft px-3 py-2 text-sm text-slate-blue">
                                      Collaborative task from {task.collaborator_name || "another VA"}. Status changes are read only here.
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone">
                                        Update status
                                      </div>
                                      <select
                                        value={task.status}
                                        onChange={(e) => handleStatusChange(task, e.target.value as AssignedTaskStatus)}
                                        disabled={isSaving}
                                        className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {STATUS_FILTERS.filter((option): option is { value: AssignedTaskStatus; label: string } => option.value !== "all").map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                      {isSaving && (
                                        <div className="text-xs text-stone">Saving status…</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-sand bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
              <h2 className="text-sm font-bold text-espresso">Add Task</h2>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddError(null);
                }}
                className="text-lg leading-none text-stone transition-colors hover:text-terracotta"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                  Task name
                </label>
                <input
                  value={addTaskName}
                  onChange={(e) => setAddTaskName(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                  placeholder="What needs to be done?"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                    Account
                  </label>
                  <input
                    value={addAccount}
                    onChange={(e) => setAddAccount(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                    Project / Objective
                  </label>
                  <input
                    value={addProject}
                    onChange={(e) => setAddProject(e.target.value)}
                    className="w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone">
                  Task notes
                </label>
                <textarea
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  className="min-h-24 w-full rounded-lg border border-sand px-3 py-2 text-sm text-espresso outline-none focus:border-terracotta"
                  placeholder="Optional notes"
                />
              </div>

              {addError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {addError}
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-parchment px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddError(null);
                }}
                className="flex-1 rounded-lg border border-sand bg-parchment px-4 py-2.5 text-sm font-semibold text-walnut transition-colors hover:bg-sand"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAddTask()}
                disabled={addSubmitting || !addTaskName.trim()}
                className="flex-1 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#a85840] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addSubmitting ? "Adding…" : "Add Task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
