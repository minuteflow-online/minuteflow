"use client";

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { VAAssignedTask, AssignedTaskStatus } from "@/types/database";
import { setAssignedTaskStatus } from "@/lib/assignedTaskStatus";
import { fetchTodos, todoLabel, type TaskTodo } from "@/lib/taskTodos";
import SubmitWorkModal from "@/components/SubmitWorkModal";
import RevisionBadge from "@/components/RevisionBadge";
import RecurringBadge from "@/components/RecurringBadge";
import { collapseRecurringSeriesBy } from "@/lib/taskSchedule";
import { formatPayMoney } from "@/lib/payroll";
import { usePayCurrency } from "@/hooks/usePayCurrency";
import { createClient } from "@/lib/supabase/client";
import { syncTaskDetailFromMemo } from "@/lib/syncTaskDetailFromMemo";

interface AssignedTasksWidgetProps {
  userId: string;
  isAdmin?: boolean;
  sessionState: string; // "idle" | "clocked-in" | "on-break" | "clocked-out"
  hasActiveTask: boolean;
  onPlayAssignedTask: (task: VAAssignedTask) => void;
  onPlayTodo: (task: VAAssignedTask, todo: TaskTodo) => void;
  /** Stops whatever task is currently running (Phase 1 of the Start/Stop/Submit
   *  rework, Toni's call 2026-11-02) — owned by the dashboard page since it has
   *  to touch the running time_log and session state, not just this widget. */
  onStopActiveTask?: () => void;
  /** Called after a submit whose task matches activeAssignedTaskId — the VA just
   *  submitted the task they're currently clocked into, so the caller should
   *  prompt for the next activity right away instead of leaving them to dwell
   *  on it. The clock itself keeps running until they actually start the next
   *  thing, same as any other task switch — no gap in what's tracked. */
  onActiveTaskSubmitted?: () => void;
  orgTimezone?: string;
  /** Increment to force a re-fetch from the server (e.g. after wizard cancel or task start). */
  refetchCount?: number;
  /** assigned_tasks.id of the currently-playing to-do's parent task, if any. */
  activeAssignedTaskId?: number | null;
  /** "TD1"/"TD2"/etc. of the currently-playing to-do, if any. */
  activeTodoLabel?: string | null;
  /** Skip the outer card/header/collapse chrome — for embedding inside a shared tabbed container that already provides its own box and tab strip. */
  bare?: boolean;
  /** Admin-only "View as VA" (Toni's call, 2026-11-11) — when set, shows that
   *  VA's own list instead of the signed-in user's, read-only: no Start/Stop/
   *  Submit/Add Memo/Accept/drag, since those act on the viewer's own session,
   *  not the VA being looked at. */
  viewAsVaId?: string | null;
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

/**
 * Status group first (unchanged from before), then each VA's own manual
 * order within that group — set by dragging tiles below. A task that's
 * never been dragged has no sort_order yet and sorts after ones that have,
 * which keeps freshly-assigned work from jumping ahead of a sequence someone
 * already set up.
 */
function compareTasks(a: VAAssignedTask, b: VAAssignedTask): number {
  const statusDiff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
  if (statusDiff !== 0) return statusDiff;
  const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
}

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
  onPlayTodo,
  onStopActiveTask,
  onActiveTaskSubmitted,
  orgTimezone = "UTC",
  refetchCount = 0,
  activeAssignedTaskId = null,
  activeTodoLabel = null,
  bare = false,
  viewAsVaId = null,
}: AssignedTasksWidgetProps) {
  const readOnly = Boolean(viewAsVaId);
  const [tasks, setTasks] = useState<VAAssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // These are this VA's own tasks, so their rates are in this VA's currency.
  const payCurrency = usePayCurrency(userId);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<number, AssignedTaskStatus>>({});
  // Submitting opens the modal first — the status only moves once the
  // submission record is saved, so "submitted" always has evidence behind it.
  const [submitTarget, setSubmitTarget] = useState<VAAssignedTask | null>(null);
  const [todosByTaskId, setTodosByTaskId] = useState<Record<number, TaskTodo[]>>({});
  const [todosLoadingId, setTodosLoadingId] = useState<number | null>(null);
  // Optimistic "has been played" set (todo.id), so a to-do turns yellow the
  // instant it's played even before a re-fetch confirms it server-side.
  const [playedTodoIds, setPlayedTodoIds] = useState<Set<number>>(new Set());
  const prevRefetchCountRef = useRef(refetchCount);
  // Drag-to-reorder: draggedId is the assignee row (task.id) currently being
  // dragged; dragOverId is whichever row the pointer is hovering, for the
  // drop-target highlight.
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  // Stop acts on whatever's currently active (there's only ever one), so one
  // flag covers every row rather than a per-id Set like updatingIds.
  const [stopping, setStopping] = useState(false);
  // Add Memo: which task's modal is open, the time_log it's editing (found by
  // lookup — the widget doesn't otherwise know raw log ids), and its fields.
  const [memoTask, setMemoTask] = useState<VAAssignedTask | null>(null);
  const [memoLogId, setMemoLogId] = useState<number | null>(null);
  const [memoClientText, setMemoClientText] = useState("");
  const [memoInternalText, setMemoInternalText] = useState("");
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState("");
  const memoSupabase = useMemo(() => createClient(), []);

  const handleStop = useCallback(async () => {
    if (!onStopActiveTask || stopping) return;
    setStopping(true);
    try {
      await onStopActiveTask();
    } finally {
      setStopping(false);
    }
  }, [onStopActiveTask, stopping]);

  const openMemoModal = useCallback(
    async (task: VAAssignedTask) => {
      setMemoTask(task);
      setMemoError("");
      setMemoLoading(true);
      setMemoClientText("");
      setMemoInternalText("");
      setMemoLogId(null);
      try {
        const { data, error } = await memoSupabase
          .from("time_logs")
          .select("id, client_memo, internal_memo")
          .eq("assigned_task_id", task.assigned_tasks.id)
          .eq("user_id", userId)
          .order("start_time", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          setMemoError("Start this task at least once before adding a memo — there's no logged time to attach it to yet.");
          return;
        }
        setMemoLogId(data.id);
        setMemoClientText(data.client_memo || "");
        setMemoInternalText(data.internal_memo || "");
      } catch {
        setMemoError("Couldn't load this task's memo. Please try again.");
      } finally {
        setMemoLoading(false);
      }
    },
    [memoSupabase, userId]
  );

  const closeMemoModal = useCallback(() => {
    setMemoTask(null);
    setMemoLogId(null);
    setMemoError("");
  }, []);

  const saveMemo = useCallback(async () => {
    if (!memoLogId) return;
    setMemoSaving(true);
    try {
      const { error } = await memoSupabase
        .from("time_logs")
        .update({
          client_memo: memoClientText || null,
          internal_memo: memoInternalText || null,
        })
        .eq("id", memoLogId);
      if (error) throw error;
      void syncTaskDetailFromMemo(memoTask?.assigned_tasks.id ?? null, memoClientText);
      closeMemoModal();
    } catch {
      setMemoError("Couldn't save — please try again.");
    } finally {
      setMemoSaving(false);
    }
  }, [memoSupabase, memoLogId, memoClientText, memoInternalText, memoTask, closeMemoModal]);

  const fetchTasks = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(
        viewAsVaId
          ? `/api/assigned-tasks?viewAsVa=${viewAsVaId}`
          : isAdmin
            ? "/api/assigned-tasks?selfOnly=true"
            : "/api/assigned-tasks"
      );
      if (res.ok) {
        const json = await res.json();
        const raw: VAAssignedTask[] = json.tasks || json || [];
        const data = raw.map((row) => ({
          ...row,
          assigned_tasks: (row.assigned_tasks as unknown as VAAssignedTask["assigned_tasks"]),
        }));
        // revision_needed is deliberately excluded (Toni's call, 2026-10-07):
        // the way back in is now the Needs Revision list on the Assignment
        // page, where the VA moves the task to On Queue themselves — it
        // reappears here once that happens, same as any other on_queue task.
        const VA_VISIBLE_STATUSES: AssignedTaskStatus[] = [
            'on_queue', 'in_progress',
          ];
        const visible = collapseRecurringSeriesBy(
          data.filter((t) => VA_VISIBLE_STATUSES.includes(t.status)),
          (t) => ({
            recurring_template_id: t.assigned_tasks?.recurring_template_id,
            due_date: t.assigned_tasks?.due_date,
            status: t.status,
          })
        ).sort(compareTasks);
        setTasks(visible);
        setOptimisticStatuses({});
      }
    } catch {
      // silently fail — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin, viewAsVaId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Re-fetch when the parent signals a change (wizard cancel, task start, etc.)
  useEffect(() => {
    if (refetchCount !== prevRefetchCountRef.current) {
      prevRefetchCountRef.current = refetchCount;
      fetchTasks();
    }
  }, [refetchCount, fetchTasks]);

  const updateStatus = useCallback(
    async (task: VAAssignedTask, newStatus: AssignedTaskStatus) => {
      const id = task.id;

      setTasks((prev) =>
        prev
          .map((t) => (t.id === id ? { ...t, status: newStatus } : t))
          .sort(compareTasks)
      );
      setUpdatingIds((prev) => new Set(prev).add(id));

      try {
        const ok = await setAssignedTaskStatus({
          assignedTaskId: task.assigned_tasks.id,
          status: newStatus,
          vaId: userId,
        });

        if (!ok) {
          setTasks((prev) =>
            prev
              .map((t) => (t.id === id ? { ...t, status: task.status } : t))
              .sort(compareTasks)
          );
        }
        // No optimistic bump on the way out of revision_needed: revision_count
        // is incremented server-side when the revision is issued, so the badge
        // is already correct here. Bumping again on Accept/Start would show R2
        // for a single revision.
      } catch {
        setTasks((prev) =>
          prev
            .map((t) => (t.id === id ? { ...t, status: task.status } : t))
            .sort(compareTasks)
        );
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [userId]
  );

  const toggleExpand = useCallback((task: VAAssignedTask) => {
    const id = task.id;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    const assignedTaskId = task.assigned_tasks.id;
    setTodosByTaskId((prev) => {
      if (assignedTaskId in prev) return prev;
      setTodosLoadingId(assignedTaskId);
      fetchTodos(assignedTaskId)
        .then((todos) => setTodosByTaskId((cur) => ({ ...cur, [assignedTaskId]: todos })))
        .finally(() => setTodosLoadingId((cur) => (cur === assignedTaskId ? null : cur)));
      return prev;
    });
  }, []);

  const handlePlay = useCallback(
    (task: VAAssignedTask) => {
      setOptimisticStatuses((prev) => ({ ...prev, [task.id]: "in_progress" }));
      onPlayAssignedTask(task);
    },
    [onPlayAssignedTask]
  );

  const cancelGrab = useCallback(
    async (task: VAAssignedTask) => {
      const id = task.id;
      const fixedPayTaskId = task.assigned_tasks.fixed_pay_task_id;
      if (fixedPayTaskId == null) return;

      setCancellingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/fixed-pay-tasks/${fixedPayTaskId}/grab`, {
          method: "DELETE",
        });
        if (res.ok) {
          await fetchTasks();
        }
      } catch {
        // non-critical widget; keep quiet on failure
      } finally {
        setCancellingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [fetchTasks]
  );

  // Saves the dragged-to order. Scoped to the caller's own rows (va_id ===
  // userId) — a collaborator's tile can appear in this list too, but its
  // sort_order belongs to them, not you, and the endpoint would reject an id
  // it isn't yours anyway.
  const persistOrder = useCallback(
    async (list: VAAssignedTask[]) => {
      const orderedIds = list.filter((t) => t.va_id === userId).map((t) => t.id);
      if (orderedIds.length === 0) return;
      try {
        await fetch("/api/assigned-tasks/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
      } catch {
        // non-critical widget; a failed save just means the order resets on the next fetch
      }
    },
    [userId]
  );

  const handleDrop = useCallback(
    (targetTask: VAAssignedTask) => {
      const sourceId = draggedId;
      setDraggedId(null);
      setDragOverId(null);
      if (sourceId == null || sourceId === targetTask.id) return;

      setTasks((prev) => {
        const source = prev.find((t) => t.id === sourceId);
        // Only your own tiles reorder, and only within the same status
        // group — a cross-group drop would just be undone by the
        // status-first sort on the very next render, so it's rejected here
        // instead of silently snapping back.
        if (!source || source.va_id !== userId || targetTask.va_id !== userId) return prev;
        if (source.status !== targetTask.status) return prev;

        const fromIndex = prev.findIndex((t) => t.id === sourceId);
        const toIndex = prev.findIndex((t) => t.id === targetTask.id);
        if (fromIndex === -1 || toIndex === -1) return prev;

        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        void persistOrder(next);
        return next;
      });
    },
    [draggedId, userId, persistOrder]
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
    <div className={bare ? "" : "bg-white border border-sand rounded-xl"}>
      {/* Header — skipped in bare mode, where a shared tab strip replaces both the title and the collapse toggle */}
      {!bare && (
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
      )}

      {(bare || !collapsed) && (
        <div className={bare ? "" : "p-[18px_20px]"}>
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
                const effectiveStatus = optimisticStatuses[task.id] ?? task.status;
                const isUpdating = updatingIds.has(task.id);
                const isCancelling = cancellingIds.has(task.id);
                const isExpanded = expandedIds.has(task.id);
                const due = detail.due_date ? formatDueDate(detail.due_date, orgTimezone) : null;
                const accountProject = [detail.account, detail.project].filter(Boolean).join(" · ");

                const rate = detail.fixed_pay_tasks?.rate;
                const primaryText = detail.task_detail || detail.task_name;
                const isOwn = task.va_id === userId;
                const isDragTarget = dragOverId === task.id && draggedId !== null && draggedId !== task.id;

                return (
                  <Fragment key={task.id}>
                    <div
                      className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border bg-white hover:bg-cream transition-colors ${
                        isDragTarget ? "border-slate-blue bg-slate-blue-soft/40" : "border-sand"
                      } ${draggedId === task.id ? "opacity-50" : ""}`}
                      onDragOver={(e) => {
                        if (draggedId == null || draggedId === task.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverId !== task.id) setDragOverId(task.id);
                      }}
                      onDragLeave={() => setDragOverId((cur) => (cur === task.id ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDrop(task);
                      }}
                    >
                      {/* Top row: drag handle + expand toggle + status badge.
                          Wraps so the badges drop under the title when the
                          column is too narrow for both — otherwise a long
                          name gets squeezed to a letter per line. */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-start gap-1 flex-[1_1_9rem] min-w-0">
                          {/* Always reserve the handle's width, even when it's not
                              draggable (a collaborator's tile) — otherwise the
                              header text would sit at a different x-offset than
                              its own detail rows below, which all use a fixed
                              pl-[30px] tuned to this slot's width. */}
                          <span
                            draggable={isOwn}
                            onDragStart={
                              isOwn
                                ? (e) => {
                                    setDraggedId(task.id);
                                    e.dataTransfer.effectAllowed = "move";
                                  }
                                : undefined
                            }
                            onDragEnd={
                              isOwn
                                ? () => {
                                    setDraggedId(null);
                                    setDragOverId(null);
                                  }
                                : undefined
                            }
                            title={isOwn ? "Drag to reorder" : undefined}
                            className={`mt-[3px] shrink-0 w-[10px] h-[14px] flex items-center justify-center transition-colors ${
                              isOwn ? "cursor-grab active:cursor-grabbing text-bark/40 hover:text-bark" : ""
                            }`}
                          >
                            {isOwn && (
                              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                                <circle cx="2.5" cy="2" r="1.4" />
                                <circle cx="7.5" cy="2" r="1.4" />
                                <circle cx="2.5" cy="7" r="1.4" />
                                <circle cx="7.5" cy="7" r="1.4" />
                                <circle cx="2.5" cy="12" r="1.4" />
                                <circle cx="7.5" cy="12" r="1.4" />
                              </svg>
                            )}
                          </span>
                          <button
                            onClick={() => toggleExpand(task)}
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
                            <span className="min-w-0 break-words text-[13px] font-semibold text-espresso leading-tight group-hover:text-terracotta transition-colors">
                              {primaryText}
                            </span>
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          <RevisionBadge count={detail.revision_count ?? 0} />
                          <RecurringBadge
                            fromTemplateId={detail.recurring_template_id}
                          />
                          {statusBadge(effectiveStatus)}
                          {rate != null && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                              {formatPayMoney(Number(rate), payCurrency)}
                            </span>
                          )}
                        </div>
                      </div>

                      {detail.task_detail && (
                        <div className="pl-[30px] text-[11px] text-stone">{detail.task_name}</div>
                      )}

                      {isExpanded && (
                        <>
                          {accountProject && (
                            <div className="text-[11px] text-bark pl-[30px]">{accountProject}</div>
                          )}

                          <div className="pl-[30px] space-y-2 mt-0.5">
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

                          {(effectiveStatus === "on_queue" || effectiveStatus === "in_progress") && (
                            <div className="pl-[30px]">
                              {todosLoadingId === detail.id ? (
                                <p className="text-[11px] text-stone/50">Loading to-dos...</p>
                              ) : (todosByTaskId[detail.id]?.length ?? 0) > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase">To-Do List</p>
                                  {todosByTaskId[detail.id]!.map((todo, i) => {
                                    const label = todoLabel(i);
                                    const isPlaying = activeAssignedTaskId === detail.id && activeTodoLabel === label;
                                    const isPlayed = playedTodoIds.has(todo.id) || Boolean(todo.played);
                                    const buttonClasses = isPlaying
                                      ? "bg-terracotta text-white hover:bg-terracotta/90"
                                      : isPlayed
                                      ? "bg-amber text-white hover:bg-amber/90"
                                      : "bg-sage text-white hover:bg-sage/90";
                                    return (
                                    <div key={todo.id} className="flex items-center gap-1.5 rounded-md border border-sand bg-parchment/40 px-2 py-1">
                                      <span className="shrink-0 rounded bg-stone/10 px-1 py-0.5 text-[9px] font-bold text-stone">{label}</span>
                                      <span className="min-w-0 flex-1 truncate text-[11px] text-espresso">{todo.text}</span>
                                      {isPlaying && (
                                        <span className="shrink-0 text-[9px] font-semibold text-terracotta">Playing</span>
                                      )}
                                      {!readOnly && (
                                      <button
                                        onClick={() => {
                                          setOptimisticStatuses((prev) => ({ ...prev, [task.id]: "in_progress" }));
                                          setPlayedTodoIds((prev) => new Set(prev).add(todo.id));
                                          onPlayTodo(task, todo);
                                        }}
                                        title={isPlaying ? `${label} is currently playing` : isPlayed ? `Play ${label} again` : `Play ${label}`}
                                        className={`shrink-0 flex items-center justify-center h-5 w-5 rounded cursor-pointer transition-colors ${buttonClasses}`}
                                      >
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                                          <polygon points="5,3 19,12 5,21" />
                                        </svg>
                                      </button>
                                      )}
                                    </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )}

                          {due && (
                            <div className={`text-[11px] font-medium pl-[30px] ${due.isOverdue ? "text-terracotta" : "text-stone"}`}>
                              {due.isOverdue && <span className="mr-1">!</span>}
                              {due.label}
                            </div>
                          )}
                        </>
                      )}

                      {/* Action buttons — hidden entirely in read-only "View as
                          VA" mode (Toni's call, 2026-11-11): these all act on
                          the viewer's own session/clock, not the VA being
                          looked at. */}
                      {!readOnly && (
                      <div className="flex items-center gap-2 mt-0.5 pl-[30px]">
                        {effectiveStatus === "pending" && (
                          <button
                            onClick={() => updateStatus(task, "on_queue")}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-[#a85840] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? "Accepting..." : "Accept"}
                          </button>
                        )}

                        {/* Also covers an in_progress task that isn't the
                            live active one (left behind by a switch, a
                            break, or legacy data) — Start just resumes it,
                            same flow as any other Start (Toni's call,
                            2026-11-03, now that Stop/switch no longer
                            demotes a task back to on_queue). */}
                        {(effectiveStatus === "on_queue" ||
                          (effectiveStatus === "in_progress" && activeAssignedTaskId !== detail.id)) && (
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

                        {detail.fixed_pay_task_id != null && effectiveStatus === "on_queue" && (
                          <button
                            onClick={() => void cancelGrab(task)}
                            disabled={isCancelling}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg border border-sand bg-parchment text-stone hover:bg-sand cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isCancelling ? "Cancelling..." : "Cancel Grab"}
                          </button>
                        )}

                        {/* Stop — Phase 1 of the Start/Stop/Submit rework
                            (Toni's call, 2026-11-02). Only the one task
                            actually running shows it; there's only ever one. */}
                        {effectiveStatus === "in_progress" && activeAssignedTaskId === detail.id && (
                          <button
                            onClick={() => void handleStop()}
                            disabled={stopping || !onStopActiveTask}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-[#a85840] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                              <rect x="4" y="4" width="16" height="16" rx="2" />
                            </svg>
                            {stopping ? "Stopping..." : "Stop"}
                          </button>
                        )}

                        {/* Submit now stays available on_queue or in_progress
                            — stopping doesn't force an immediate submit, and
                            a stopped task that's not resumed yet is exactly
                            what still needs this button (Toni's call). */}
                        {(effectiveStatus === "on_queue" || effectiveStatus === "in_progress") && (
                          <button
                            onClick={() => setSubmitTarget(task)}
                            disabled={isUpdating}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isUpdating ? "Submitting..." : "Submit"}
                          </button>
                        )}

                        {/* Add Memo — standalone, not folded into Submit
                            (confirmed by Toni's own mockup, 2026-11-02). */}
                        {(effectiveStatus === "on_queue" || effectiveStatus === "in_progress") && (
                          <button
                            onClick={() => void openMemoModal(task)}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-amber text-white hover:bg-amber/90 cursor-pointer transition-colors"
                          >
                            Add Memo
                          </button>
                        )}
                      </div>
                      )}
                    </div>

                    {isExpanded && <div className="h-1" />}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {submitTarget && (
        <SubmitWorkModal
          taskId={submitTarget.assigned_tasks.id}
          taskName={submitTarget.assigned_tasks.task_name}
          instructions={submitTarget.assigned_tasks.instructions}
          reviewRequired={submitTarget.assigned_tasks.review_required}
          onClose={() => setSubmitTarget(null)}
          onSubmitted={(status) => {
            const task = submitTarget;
            setSubmitTarget(null);
            // The server decides: submitted, or completed/approved when the
            // task's category or review_required says no review is needed.
            void updateStatus(task, status);
            // updateStatus only writes the assignment row — it never touches
            // the running time_log, so without this the VA's clock just kept
            // ticking against a task that was already turned in until they
            // happened to notice and switch (this was the multi-hour "from
            // submit to task" gap in Reports). Only fire when the task just
            // submitted is the one actually being clocked right now.
            if (activeAssignedTaskId === task.assigned_tasks.id) {
              onActiveTaskSubmitted?.();
            }
          }}
        />
      )}

      {memoTask && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeMemoModal();
          }}
        >
          <div className="mx-4 w-full max-w-md rounded-xl border border-sand bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-sand px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-xs font-bold uppercase tracking-wide text-espresso">Add Memo</h3>
                <p className="truncate text-[13px] font-semibold leading-snug text-espresso">
                  {memoTask.assigned_tasks.task_name}
                </p>
              </div>
              <button
                onClick={closeMemoModal}
                className="shrink-0 text-stone hover:text-espresso"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              {memoLoading ? (
                <p className="text-[12px] italic text-stone/60">Loading…</p>
              ) : memoError ? (
                <p className="text-[12px] text-terracotta">{memoError}</p>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                      Client memo
                    </label>
                    <textarea
                      value={memoClientText}
                      onChange={(e) => setMemoClientText(e.target.value)}
                      rows={3}
                      placeholder="Visible on the client-facing report..."
                      className="w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-walnut">
                      Internal memo
                    </label>
                    <textarea
                      value={memoInternalText}
                      onChange={(e) => setMemoInternalText(e.target.value)}
                      rows={3}
                      placeholder="Internal only — not shown to the client..."
                      className="w-full resize-none rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-espresso outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void saveMemo()}
                      disabled={memoSaving}
                      className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50"
                    >
                      {memoSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={closeMemoModal}
                      disabled={memoSaving}
                      className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
