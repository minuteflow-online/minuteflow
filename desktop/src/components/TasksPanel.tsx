// On-queue / in-progress assigned tasks — mirrors web's AssignedTasksWidget.tsx.
// Card, status badges, the R revision badge, row layout, the Start/Submit
// buttons, and drag-to-reorder are all copied from that component and
// AGENTS.md's Status Badge / Task list item / Button patterns — same
// classes, same behavior. Drag state (draggedId/dragOverId) is ephemeral UI
// state kept local to this component, same as the web widget; the actual
// reorder (array splice + persist) is App's to do since it owns `tasks`,
// mirroring how onSelect/onStart already work.
//
// No "Available" tab and no revision_needed here — both removed 2026-10-08
// (Toni's call, matching the same change already made on web): a pending
// task no longer shows anywhere on desktop (Accept happens on web), and a
// sent-back task drops out of this list entirely until it's back on_queue —
// the way back in is the Needs Revision list on web's Assignment page, not a
// Rework button here. The R badge still shows once a reworked task reappears
// on_queue/in_progress, since revision_count is a historical count that
// doesn't reset — see RevisionBadge.
import { useCallback, useState } from "react";
import { query } from "../lib/db";
import { syncTaskDetailFromMemo, type VAAssignedTask, type AssignedTaskStatus } from "../lib/tasks";
import RevisionBadge from "./RevisionBadge";

interface TasksPanelProps {
  tasks: VAAssignedTask[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (task: VAAssignedTask) => void;
  startingId: number | null;
  onStart: (task: VAAssignedTask) => void;
  /** For the Add Memo lookup below — which time_log row belongs to this VA. */
  userId: string;
  /** Real Stop — halts billing for this task without starting anything else
   *  (Phase 1/4, Toni's call, 2026-11-02; matches web's AssignedTasksWidget). */
  stoppingId: number | null;
  onStop: (task: VAAssignedTask) => void;
  /** Gates the Stop button to only the task that's genuinely the session's
   *  active one — a task's "in_progress" status badge can be stale (today's
   *  Clock Out gate bug showed exactly that), so Stop only shows where it's
   *  actually backed by a running timer. Matches web's
   *  activeAssignedTaskId === detail.id check. */
  activeAssignedTaskId: number | null;
  onSubmit: (task: VAAssignedTask) => void;
  onReorder: (source: VAAssignedTask, target: VAAssignedTask) => void;
  /** Skip the outer card chrome — for embedding inside TaskWidgetsTabs,
   *  which already provides its own box and tab strip. Mirrors web's
   *  AssignedTasksWidget `bare` prop. */
  bare?: boolean;
}

function statusBadge(status: AssignedTaskStatus) {
  switch (status) {
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
    default:
      return null;
  }
}

export default function TasksPanel({
  tasks,
  loading,
  selectedId,
  onSelect,
  startingId,
  onStart,
  userId,
  stoppingId,
  onStop,
  activeAssignedTaskId,
  onSubmit,
  onReorder,
  bare = false,
}: TasksPanelProps) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Add Memo: which task's modal is open, the time_log it's editing (found
  // by lookup — this panel doesn't otherwise know raw log ids), and its
  // fields. Mirrors web's AssignedTasksWidget exactly (Toni's call,
  // 2026-11-03 — the one piece of the Phase 1/4 port left out until now).
  const [memoTask, setMemoTask] = useState<VAAssignedTask | null>(null);
  const [memoLogId, setMemoLogId] = useState<number | null>(null);
  const [memoClientText, setMemoClientText] = useState("");
  const [memoInternalText, setMemoInternalText] = useState("");
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState("");

  const openMemoModal = useCallback(
    async (task: VAAssignedTask) => {
      setMemoTask(task);
      setMemoError("");
      setMemoLoading(true);
      setMemoClientText("");
      setMemoInternalText("");
      setMemoLogId(null);
      try {
        const rows = await query<{ id: number; client_memo: string | null; internal_memo: string | null }[]>(
          "time_logs",
          {
            filters: `assigned_task_id=eq.${task.assigned_tasks.id}&user_id=eq.${userId}&select=id,client_memo,internal_memo&order=start_time.desc&limit=1`,
          }
        );
        const data = rows[0];
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
    [userId]
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
      await query("time_logs", {
        method: "PATCH",
        filters: `id=eq.${memoLogId}`,
        body: {
          client_memo: memoClientText || null,
          internal_memo: memoInternalText || null,
        },
      });
      void syncTaskDetailFromMemo(memoTask?.assigned_tasks.id ?? null, memoClientText);
      closeMemoModal();
    } catch {
      setMemoError("Couldn't save — please try again.");
    } finally {
      setMemoSaving(false);
    }
  }, [memoLogId, memoClientText, memoInternalText, memoTask, closeMemoModal]);

  return (
    <div
      className={
        bare
          ? "space-y-1.5 flex-1 min-h-0 flex flex-col"
          : "rounded-xl border border-sand bg-white p-4 space-y-3 flex-1 min-h-0 flex flex-col"
      }
    >
      {!bare && (
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">
          Assigned{tasks.length > 0 ? ` (${tasks.length})` : ""}
        </h3>
      )}

      <div className="space-y-1.5 overflow-y-auto min-h-0">
        {loading ? (
          [1, 2, 3].map((i) => <div key={i} className="animate-pulse h-12 w-full bg-parchment rounded-lg" />)
        ) : tasks.length === 0 ? (
          <p className="text-xs text-stone py-3 text-center">No assigned tasks.</p>
        ) : (
          tasks.map((task) => {
            const detail = task.assigned_tasks;
            const isSelected = selectedId === task.id;
            const isStarting = startingId === task.id;
            const isFixedPay = detail.fixed_pay_task_id != null;
            const rate = detail.fixed_pay_tasks?.rate;
            const isDragTarget = dragOverId === task.id && draggedId !== null && draggedId !== task.id;

            return (
              <div
                key={task.id}
                className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border transition-colors ${
                  isDragTarget
                    ? "border-slate-blue bg-slate-blue-soft/40"
                    : isSelected
                      ? "border-terracotta bg-cream"
                      : "border-sand bg-white hover:bg-cream"
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
                  const sourceId = draggedId;
                  setDraggedId(null);
                  setDragOverId(null);
                  if (sourceId == null || sourceId === task.id) return;
                  const source = tasks.find((t) => t.id === sourceId);
                  // Same-status-group only — a cross-group drop would just be
                  // undone by the status-first sort on the next render.
                  if (source && source.status === task.status) onReorder(source, task);
                }}
              >
                <div className="flex items-start gap-1">
                  {/* Reserves the handle's width even while dragging, so the
                      title text doesn't jump. */}
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDraggedId(task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    title="Drag to reorder"
                    className="mt-[3px] shrink-0 w-[10px] h-[14px] flex items-center justify-center text-bark/40 cursor-grab active:cursor-grabbing hover:text-bark transition-colors"
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                      <circle cx="2.5" cy="2" r="1.4" />
                      <circle cx="7.5" cy="2" r="1.4" />
                      <circle cx="2.5" cy="7" r="1.4" />
                      <circle cx="7.5" cy="7" r="1.4" />
                      <circle cx="2.5" cy="12" r="1.4" />
                      <circle cx="7.5" cy="12" r="1.4" />
                    </svg>
                  </span>

                  <div className="flex-1 min-w-0">
                    {/* Wraps so the badges drop under the title when the column
                        is too narrow for both — otherwise a long name gets
                        squeezed to a letter per line (same fix as web). */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        onClick={() => onSelect(task)}
                        className="flex-[1_1_9rem] min-w-0 text-left cursor-pointer"
                      >
                        <span className="min-w-0 break-words text-[13px] font-semibold text-espresso leading-tight">
                          {detail.task_detail || detail.task_name}
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <RevisionBadge count={detail.revision_count ?? 0} />
                        {statusBadge(task.status)}
                        {rate != null && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700">
                            ${Number(rate).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {(detail.account || detail.project) && (
                      <button
                        onClick={() => onSelect(task)}
                        className="text-left text-[11px] text-stone/80 cursor-pointer"
                      >
                        {[detail.account, detail.project].filter(Boolean).join(" · ")}
                      </button>
                    )}

                    {(task.status === "on_queue" || task.status === "in_progress") && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {task.status === "on_queue" && (
                          <button
                            onClick={() => onStart(task)}
                            disabled={isStarting || isFixedPay}
                            title={
                              isFixedPay
                                ? "Fixed-pay tasks aren't supported here yet — start from the web app."
                                : undefined
                            }
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sage text-white hover:bg-sage/90 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5,3 19,12 5,21" />
                            </svg>
                            {isStarting ? "Starting..." : "Start"}
                          </button>
                        )}
                        {task.status === "in_progress" && activeAssignedTaskId === detail.id && (
                          <button
                            onClick={() => onStop(task)}
                            disabled={stoppingId === task.id}
                            className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-terracotta/90 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <rect x="5" y="5" width="14" height="14" />
                            </svg>
                            {stoppingId === task.id ? "Stopping..." : "Stop"}
                          </button>
                        )}
                        <button
                          onClick={() => onSubmit(task)}
                          className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 cursor-pointer transition-colors"
                        >
                          Submit
                        </button>
                        <button
                          onClick={() => void openMemoModal(task)}
                          className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-amber text-white hover:bg-amber/90 cursor-pointer transition-colors"
                        >
                          Add Memo
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

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
                className="shrink-0 text-stone hover:text-espresso cursor-pointer"
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
                      className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sage/90 disabled:opacity-50 cursor-pointer"
                    >
                      {memoSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={closeMemoModal}
                      disabled={memoSaving}
                      className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone transition-colors hover:bg-stone/20 disabled:opacity-50 cursor-pointer"
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
