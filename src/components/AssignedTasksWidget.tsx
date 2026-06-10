"use client";

import { useState, useEffect, useCallback } from "react";
import type { VAAssignedTask, AssignedTaskStatus } from "@/types/database";

interface AssignedTasksWidgetProps {
  userId: string;
  sessionState: string; // "idle" | "clocked-in" | "on-break" | "clocked-out"
  hasActiveTask: boolean;
  onPlayAssignedTask: (task: VAAssignedTask) => void;
  orgTimezone?: string;
}

function formatDueDate(dueDateStr: string, orgTimezone: string): { label: string; isOverdue: boolean } {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: orgTimezone });
  const today = new Date(todayStr + "T12:00:00Z");
  const due = new Date(dueDateStr + "T12:00:00Z");
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { label: "Due today", isOverdue: false };
  if (diffDays === 1) return { label: "Due tomorrow", isOverdue: false };
  if (diffDays === -1) return { label: "Due yesterday", isOverdue: true };
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, isOverdue: true };

  const dueDate = new Date(dueDateStr + "T12:00:00Z");
  const label = dueDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: orgTimezone,
  });
  return { label: `Due ${label}`, isOverdue: false };
}

const STATUS_SORT_ORDER: Record<AssignedTaskStatus, number> = {
  on_queue: 0,
  in_progress: 1,
  pending: 2,
  completed: 3,
  cancelled: 4,
};

export default function AssignedTasksWidget({
  userId,
  onPlayAssignedTask,
  orgTimezone = "UTC",
}: AssignedTasksWidgetProps) {
  const [tasks, setTasks] = useState<VAAssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  const fetchTasks = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/assigned-tasks");
      if (res.ok) {
        const json = await res.json();
        const raw: VAAssignedTask[] = json.tasks || json || [];
        const data = raw.map((row) => ({
          ...row,
          // API returns the relation as assigned_tasks (object, not array)
          assigned_tasks: (row.assigned_tasks as unknown as VAAssignedTask["assigned_tasks"]),
        }));
        const visible = data
          .filter((t) => t.status !== "cancelled" && t.status !== "completed")
          .sort(
            (a, b) =>
              (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
          );
        setTasks(visible);
      }
    } catch {
      // silently fail — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateStatus = useCallback(
    async (task: VAAssignedTask, newStatus: AssignedTaskStatus) => {
      const id = task.id;

      // Optimistic update
      setTasks((prev) =>
        prev
          .map((t) => (t.id === id ? { ...t, status: newStatus } : t))
          .filter((t) => t.status !== "cancelled" && t.status !== "completed")
          .sort(
            (a, b) =>
              (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
          )
      );
      setUpdatingIds((prev) => new Set(prev).add(id));

      try {
        const res = await fetch(`/api/assigned-tasks/${task.assigned_tasks.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) {
          // Revert on error
          setTasks((prev) =>
            prev
              .map((t) => (t.id === id ? { ...t, status: task.status } : t))
              .filter((t) => t.status !== "cancelled" && t.status !== "completed")
              .sort(
                (a, b) =>
                  (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
              )
          );
        }
      } catch {
        // Revert on error
        setTasks((prev) =>
          prev
            .map((t) => (t.id === id ? { ...t, status: task.status } : t))
            .filter((t) => t.status !== "cancelled" && t.status !== "completed")
            .sort(
              (a, b) =>
                (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
            )
        );
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    []
  );

  const handlePlay = useCallback(
    (task: VAAssignedTask) => {
      onPlayAssignedTask(task);
    },
    [onPlayAssignedTask]
  );

  const statusBadge = (status: AssignedTaskStatus) => {
    switch (status) {
      case "pending":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20">
            Pending
          </span>
        );
      case "on_queue":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-slate-blue/10 text-slate-blue border border-slate-blue/20">
            On Queue
          </span>
        );
      case "in_progress":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200">
            In Progress
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-sand rounded-xl">
      {/* Header */}
      <div className="py-4 px-5 border-b border-parchment flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className={`text-bark transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h3 className="text-sm font-bold text-espresso">Assigned Tasks</h3>
        </button>
        {tasks.length > 0 && (
          <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="p-[18px_20px]">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse h-12 w-full bg-parchment rounded-lg" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-stone py-3 text-center">No assigned tasks.</p>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((task) => {
                const detail = task.assigned_tasks;
                const isUpdating = updatingIds.has(task.id);
                const due =
                  detail.due_date
                    ? formatDueDate(detail.due_date, orgTimezone)
                    : null;

                const accountProject = [detail.account, detail.project]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <div
                    key={task.id}
                    className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors"
                  >
                    {/* Top row: task name + status badge */}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold text-espresso leading-tight flex-1 min-w-0">
                        {detail.task_name}
                      </span>
                      {statusBadge(task.status)}
                    </div>

                    {/* Account · Project */}
                    {accountProject && (
                      <div className="text-[11px] text-bark">{accountProject}</div>
                    )}

                    {/* Task detail */}
                    {detail.task_detail && (
                      <div className="text-[11px] text-stone/80 leading-relaxed line-clamp-2">
                        {detail.task_detail}
                      </div>
                    )}

                    {/* Due date */}
                    {due && (
                      <div
                        className={`text-[11px] font-medium ${
                          due.isOverdue ? "text-terracotta" : "text-stone"
                        }`}
                      >
                        {due.isOverdue && (
                          <span className="mr-1">!</span>
                        )}
                        {due.label}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.status === "pending" && (
                        <button
                          onClick={() => updateStatus(task, "on_queue")}
                          disabled={isUpdating}
                          className="text-[11px] font-semibold py-1 px-3 rounded-lg bg-slate-blue/10 text-slate-blue border border-slate-blue/20 hover:bg-slate-blue/20 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpdating ? "Queuing..." : "Queue It"}
                        </button>
                      )}

                      {task.status === "on_queue" && (
                        <>
                          <button
                            onClick={() => handlePlay(task)}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sage text-white hover:bg-sage/90 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5,3 19,12 5,21" />
                            </svg>
                            Play
                          </button>
                          <button
                            onClick={() => updateStatus(task, "pending")}
                            disabled={isUpdating}
                            className="text-[11px] text-stone hover:text-terracotta cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Remove from Queue
                          </button>
                        </>
                      )}

                      {task.status === "in_progress" && (
                        <span className="text-[11px] text-stone italic">
                          Already in progress
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
