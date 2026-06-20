"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AssignedTask, FixedPayTaskWithClaimer, VAAssignedTask } from "@/types/database";

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

function renderTextWithLinks(text: string) {
  const parts: ReactElement[] = [];
  const urlRegex = /(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+|www\.[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    const rawUrl = match[0];
    const href = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    parts.push(
      <a key={`link-${match.index}`} href={href} target="_blank" rel="noreferrer" className="text-terracotta hover:underline">
        {rawUrl}
      </a>
    );
    lastIndex = match.index + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : [<span key="empty">{text}</span>];
}

export default function AvailableTasksWidget({
  onClaimed,
  canSeeFixedPay = true,
  fixedPayOnly = false,
  currentUserId,
}: {
  onClaimed?: () => void;
  canSeeFixedPay?: boolean;
  fixedPayOnly?: boolean;
  currentUserId?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [viewMode, setViewMode] = useState<"fixed_pay" | "hourly">(
    fixedPayOnly || canSeeFixedPay ? "fixed_pay" : "hourly"
  );
  const [tasks, setTasks] = useState<FixedPayTaskWithClaimer[]>([]);
  const [pendingAssigned, setPendingAssigned] = useState<VAAssignedTask[]>([]);
  const [hourlyTasks, setHourlyTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [hourlyGrabbingId, setHourlyGrabbingId] = useState<number | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fixedPayOnly) {
      if (viewMode !== "fixed_pay") setViewMode("fixed_pay");
      return;
    }

    if (!canSeeFixedPay && viewMode === "fixed_pay") {
      setViewMode("hourly");
    }
  }, [canSeeFixedPay, fixedPayOnly, viewMode]);

  const toggleExpanded = useCallback((id: string) => {
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

  const renderDetails = useCallback((fields: {
    taskDetail?: string | null;
    instructions?: string | null;
    link?: string | null;
    notes?: string | null;
  }) => {
    const hasAnyContent = [fields.taskDetail, fields.instructions, fields.link, fields.notes].some((value) => Boolean(value?.trim()));

    return (
      <div className="space-y-2">
        {fields.taskDetail?.trim() && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-stone">Details</p>
            <div className="text-[11px] text-espresso whitespace-pre-wrap">{fields.taskDetail}</div>
          </div>
        )}
        {fields.instructions?.trim() && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-stone">Instructions</p>
            <div className="text-[11px] text-espresso whitespace-pre-wrap">{renderTextWithLinks(fields.instructions)}</div>
          </div>
        )}
        {fields.link?.trim() && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-stone">Link</p>
            <a
              href={fields.link.startsWith("http") ? fields.link : `https://${fields.link}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-terracotta hover:underline break-all"
            >
              {fields.link}
            </a>
          </div>
        )}
        {fields.notes?.trim() && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-stone">Notes</p>
            <div className="text-[11px] text-espresso whitespace-pre-wrap">{fields.notes}</div>
          </div>
        )}
        {!hasAnyContent && <span className="text-stone italic text-[11px]">No details provided.</span>}
      </div>
    );
  }, []);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === "fixed_pay") {
        if (!canSeeFixedPay) {
          setTasks([]);
          setPendingAssigned([]);
          setHourlyTasks([]);
          return;
        }

        const [fixedRes, assignedRes] = await Promise.all([
          fetch("/api/fixed-pay-tasks", { cache: "no-store" }),
          fetch("/api/assigned-tasks?status=pending&selfOnly=true", { cache: "no-store" }),
        ]);

        if (!fixedRes.ok) throw new Error(`HTTP ${fixedRes.status}`);
        const fixedJson = await fixedRes.json();
        const fixedRows = Array.isArray(fixedJson) ? fixedJson : fixedJson.tasks ?? [];
        setTasks(fixedRows as FixedPayTaskWithClaimer[]);

        if (assignedRes.ok) {
          const assignedJson = await assignedRes.json();
          const assignedRows = (assignedJson.tasks ?? []) as VAAssignedTask[];
          // Only show fixed pay directly-assigned tasks here; hourly pending tasks appear in My Tasks
          setPendingAssigned(assignedRows.filter((row) => row.assigned_tasks?.fixed_pay_task_id != null));
        }

        setHourlyTasks([]);
      } else {
        setTasks([]);
        setPendingAssigned([]);

        const { data, error: hourlyError } = await supabase
          .from("assigned_tasks")
          .select("id, account, project, task_name, due_date, fixed_pay_task_id, status, archived_at, deleted_at, created_at, updated_at")
          .eq("status", "unassigned")
          .is("fixed_pay_task_id", null)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("created_at", { ascending: false });

        if (hourlyError) throw new Error(hourlyError.message);
        setHourlyTasks((data ?? []) as AssignedTask[]);
      }
    } catch {
      setError("Unable to load available tasks right now.");
    } finally {
      setLoading(false);
    }
  }, [canSeeFixedPay, supabase, viewMode]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleClaim = useCallback(
    async (taskId: number) => {
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

  const handleHourlyGrab = useCallback(
    async (taskId: number) => {
      setHourlyGrabbingId(taskId);
      setError(null);
      try {
        const res = await fetch(`/api/assigned-tasks/${taskId}/grab`, {
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
        setError(err instanceof Error ? err.message : "Failed to grab task.");
      } finally {
        setHourlyGrabbingId(null);
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
          body: JSON.stringify({ status: "on_queue", ...(currentUserId ? { va_id: currentUserId } : {}) }),
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
    [currentUserId, onClaimed]
  );

  const openTasks = viewMode === "fixed_pay" && canSeeFixedPay ? tasks.filter((t) => !t.claimed_by_me) : [];
  const totalCount = viewMode === "fixed_pay" ? pendingAssigned.length + openTasks.length : hourlyTasks.length;

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

      {!fixedPayOnly && (
        <div className="inline-flex rounded-lg border border-sand bg-parchment/40 p-1 text-xs font-semibold">
          {canSeeFixedPay && (
            <button
              type="button"
              onClick={() => setViewMode("fixed_pay")}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                viewMode === "fixed_pay" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
              }`}
            >
              Fixed Pay
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewMode("hourly")}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              viewMode === "hourly" ? "bg-white text-espresso shadow-sm" : "text-stone hover:text-espresso"
            }`}
          >
            Hourly
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-stone text-[11px] text-center py-3">Loading...</p>
      ) : totalCount === 0 ? (
        <p className="text-stone text-[11px] text-center py-3 italic">No available tasks right now.</p>
      ) : viewMode === "hourly" ? (
        <div className="space-y-1.5">
          {hourlyTasks.map((task) => {
            const isGrabbing = hourlyGrabbingId === task.id;
            const due = formatDueDate(task.due_date);
            const dueBadgeClass = due.isOverdue ? "bg-terracotta/10 text-terracotta" : "bg-sage-soft text-sage";

            return (
              <div key={task.id} className="rounded-lg border border-sand overflow-hidden">
                <div className="px-2.5 py-2 bg-parchment/20">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-espresso truncate">{task.task_name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${dueBadgeClass}`}>
                      {due.label === "—" ? "No due date" : `Due ${due.label}`}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {task.account ?? ""}
                    {task.project ? ` / ${task.project}` : ""}
                  </div>
                </div>

                <div className="px-2.5 py-2.5 bg-parchment/10 space-y-2">
                  <div className="text-[11px] text-stone">Open pool — grab this task to assign it to yourself.</div>
                  <button
                    type="button"
                    onClick={() => void handleHourlyGrab(task.id)}
                    disabled={isGrabbing}
                    className="w-full cursor-pointer rounded-lg bg-sage px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGrabbing ? "Grabbing..." : "Grab This Task"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Pending assigned tasks (admin-assigned, awaiting acceptance) */}
          {pendingAssigned.length > 0 && (
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase px-0.5 pt-1">Assigned to You</p>
          )}
          {pendingAssigned.map((task) => {
            const assigneeId = String(task.id);
            const isAccepting = acceptingId === assigneeId;
            const isExpanded = expandedIds.has(`assigned-${task.id}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rate = (task.assigned_tasks as any)?.fixed_pay_tasks?.rate;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assignedTask = task.assigned_tasks as any;
            return (
              <div key={`assigned-${task.id}`} className="rounded-lg border border-sand overflow-hidden">
                <div className="px-2.5 py-2 bg-parchment/20">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-espresso truncate">{task.assigned_tasks.task_name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {rate != null && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                          ${Number(rate).toFixed(2)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(`assigned-${task.id}`)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                        className="p-1 rounded-full hover:bg-stone-100/60 transition-colors"
                      >
                        <svg
                          className={`h-3 w-3 text-stone transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone mt-0.5 truncate">
                    {task.assigned_tasks.account ?? ""}
                    {task.assigned_tasks.project ? ` / ${task.assigned_tasks.project}` : ""}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-2.5 py-2.5 bg-parchment/10 border-t border-sand/60">
                    {renderDetails({
                      taskDetail: assignedTask.task_detail,
                      instructions: assignedTask.instructions,
                      link: assignedTask.link,
                      notes: assignedTask.task_notes,
                    })}
                  </div>
                )}

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

          {canSeeFixedPay && (
            <>
              {/* Fixed-pay tasks available to grab */}
              {openTasks.length > 0 && (
                <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase px-0.5 pt-1">Fixed Pay Tasks</p>
              )}
              {openTasks.map((task) => {
                const isClaiming = claimingId === task.id;
                const isExpanded = expandedIds.has(`fixed-${task.id}`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const taskData = task as any;
                return (
                  <div key={task.id} className="rounded-lg border border-sand overflow-hidden">
                    <div className="px-2.5 py-2 bg-parchment/20">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-espresso truncate">{task.task_name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                            ${Number(task.rate).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(`fixed-${task.id}`)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                            className="p-1 rounded-full hover:bg-stone-100/60 transition-colors"
                          >
                            <svg
                              className={`h-3 w-3 text-stone transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-stone mt-0.5 truncate">
                        {task.account ?? ""}
                        {task.category ? ` / ${task.category}` : ""}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-2.5 py-2.5 bg-parchment/10 border-t border-sand/60">
                        {renderDetails({
                          taskDetail: taskData.task_detail,
                          instructions: taskData.instructions,
                          link: taskData.link,
                          notes: taskData.task_notes,
                        })}
                      </div>
                    )}

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
            </>
          )}
        </div>
      )}
    </div>
  );
}
