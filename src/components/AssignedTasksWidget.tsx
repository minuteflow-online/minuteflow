"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import type { VAAssignedTask, AssignedTaskStatus } from "@/types/database";

interface AssignedTasksWidgetProps {
  userId: string;
  isAdmin?: boolean;
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
  unassigned: -2,
  pending: -1,
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

function renderTextWithLinks(text: string) {
  const parts: React.JSX.Element[] = [];
  const urlRegex = /(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+|www\.[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    const rawUrl = match[0];
    const href = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    parts.push(
      <a key={`link-${match.index}`} href={href} target="_blank" rel="noreferrer" className="text-terracotta hover:underline">
        {rawUrl}
      </a>
    );
    lastIndex = match.index + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key={`text-${lastIndex}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return parts.length > 0 ? parts : [<Fragment key="empty">{text}</Fragment>];
}

export default function AssignedTasksWidget({
  userId,
  isAdmin = false,
  onPlayAssignedTask,
  orgTimezone = "UTC",
}: AssignedTasksWidgetProps) {
  const [tasks, setTasks] = useState<VAAssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());


  const fetchTasks = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(isAdmin ? "/api/assigned-tasks?selfOnly=true" : "/api/assigned-tasks");
      if (res.ok) {
        const json = await res.json();
        const raw: VAAssignedTask[] = json.tasks || json || [];
        const data = raw.map((row) => ({
          ...row,
          assigned_tasks: (row.assigned_tasks as unknown as VAAssignedTask["assigned_tasks"]),
        }));
        const visible = data
          .filter((t) => t.status === 'on_queue' || t.status === 'in_progress')
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
  }, [userId, isAdmin]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateStatus = useCallback(
    async (task: VAAssignedTask, newStatus: AssignedTaskStatus) => {
      const id = task.id;

      setTasks((prev) =>
        prev
          .map((t) => (t.id === id ? { ...t, status: newStatus } : t))
          .sort(
            (a, b) =>
              (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
          )
      );
      setUpdatingIds((prev) => new Set(prev).add(id));

      try {
        const body: Record<string, unknown> = { status: newStatus };
        if (isAdmin) body.va_id = userId;
        const res = await fetch(`/api/assigned-tasks/${task.assigned_tasks.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          setTasks((prev) =>
            prev
              .map((t) => (t.id === id ? { ...t, status: task.status } : t))
              .sort(
                (a, b) =>
                  (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
              )
          );
        }
      } catch {
        setTasks((prev) =>
          prev
            .map((t) => (t.id === id ? { ...t, status: task.status } : t))
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

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handlePlay = useCallback(
    (task: VAAssignedTask) => {
      setTasks((prev) =>
        prev
          .map((t): VAAssignedTask =>
            t.id === task.id ? { ...t, status: "in_progress" as AssignedTaskStatus } : t
          )
          .sort(
            (a, b) =>
              (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
          )
      );
      onPlayAssignedTask(task);
    },
    [onPlayAssignedTask]
  );


  const statusBadge = (status: AssignedTaskStatus) => {
    switch (status) {
      case "pending":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-slate-blue-soft text-slate-blue border border-slate-blue/20">
            Pending
          </span>
        );
      case "on_queue":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20">
            On Queue
          </span>
        );
      case "in_progress":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-500 border border-amber-200">
            In Progress
          </span>
        );
      case "submitted":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-sky-50 text-sky-600 border border-sky-200">
            Submitted
          </span>
        );
      case "reviewing":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-violet-50 text-violet-600 border border-violet-200">
            Reviewing
          </span>
        );
      case "revision_needed":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-600 border border-amber-200">
            Revision Needed
          </span>
        );
      case "approved":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
            Approved
          </span>
        );
      case "completed":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-sage-soft text-sage border border-sage/20">
            Completed
          </span>
        );
      case "paid":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-purple-50 text-purple-600 border border-purple-200">
            Paid
          </span>
        );
      case "cancelled":
        return (
          <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-red-50 text-red-500 border border-red-200">
            Cancelled
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
        <div className="flex items-center gap-2">
          {tasks.length > 0 && (
            <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
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
                const isExpanded = expandedIds.has(task.id);
                const due = detail.due_date ? formatDueDate(detail.due_date, orgTimezone) : null;
                const accountProject = [detail.account, detail.project].filter(Boolean).join(" · ");

                const rate = detail.fixed_pay_tasks?.rate;

                return (
                  <Fragment key={task.id}>
                    <div className="flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border border-sand bg-white hover:bg-cream transition-colors">
                      {/* Top row: task name + expand toggle + status badge */}
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => toggleExpand(task.id)}
                          className="flex items-start gap-1.5 flex-1 min-w-0 text-left cursor-pointer group"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 12 12"
                            className={`text-bark mt-[3px] shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
                          <span className="text-[13px] font-semibold text-espresso leading-tight group-hover:text-terracotta transition-colors">
                            {detail.task_name}
                          </span>
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {statusBadge(task.status)}
                          {rate != null && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                              ${Number(rate).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <>
                          {accountProject && (
                            <div className="text-[11px] text-bark pl-[18px]">{accountProject}</div>
                          )}

                          <div className="pl-[18px] space-y-2 mt-0.5">
                            {detail.task_detail && (
                              <div>
                                <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase">Detail</p>
                                <p className="text-[11px] text-stone/80 leading-relaxed">{detail.task_detail}</p>
                              </div>
                            )}
                            {detail.task_notes && (
                              <div>
                                <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase">Notes</p>
                                <p className="text-[11px] text-stone/80 leading-relaxed whitespace-pre-wrap">{detail.task_notes}</p>
                              </div>
                            )}
                            {detail.instructions && (
                              <div>
                                <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase">Instructions</p>
                                <div className="text-[11px] text-stone/80 leading-relaxed whitespace-pre-wrap">
                                  {renderTextWithLinks(detail.instructions)}
                                </div>
                              </div>
                            )}
                            {!detail.task_detail && !detail.task_notes && (
                              <p className="text-[11px] text-stone/50 italic">No additional details.</p>
                            )}
                          </div>

                          {due && (
                            <div className={`text-[11px] font-medium pl-[18px] ${due.isOverdue ? "text-terracotta" : "text-stone"}`}>
                              {due.isOverdue && <span className="mr-1">!</span>}
                              {due.label}
                            </div>
                          )}
                        </>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-0.5 pl-[18px]">
                        {task.status === "pending" && (
                          <button
                            onClick={() => updateStatus(task, "on_queue")}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-[#a85840] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? "Accepting..." : "Accept"}
                          </button>
                        )}

                        {task.status === "on_queue" && (
                          <button
                            onClick={() => handlePlay(task)}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sage text-white hover:bg-sage/90 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5,3 19,12 5,21" />
                            </svg>
                            {isUpdating ? "Starting..." : "Start"}
                          </button>
                        )}

                        {task.status === "in_progress" && (
                          <button
                            onClick={() => updateStatus(task, "submitted")}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? "Submitting..." : "Submit"}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && <div className="h-1" />}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
