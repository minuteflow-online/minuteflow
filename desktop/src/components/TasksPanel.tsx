// On-queue / in-progress / revision-needed assigned tasks, plus a separate
// "Available" tab for pending ones awaiting Accept — mirrors how web keeps
// AssignedTasksWidget.tsx and AvailableTasksWidget.tsx as two entirely
// separate cards rather than one mixed list (tried folding pending into the
// single list once; it got noisy the moment a VA had more than a couple).
// Card, status badges, the R revision badge, row layout, the Accept/Start/
// Rework/Submit buttons, and drag-to-reorder (assigned tab only — pending
// tasks aren't reorderable on web either) are all copied from those two web
// components and AGENTS.md's Status Badge / Task list item / Button
// patterns — same classes, same behavior. Drag state (draggedId/dragOverId)
// is ephemeral UI state kept local to this component, same as the web
// widget; the actual reorder (array splice + persist) is App's to do since
// it owns `tasks`, mirroring how onSelect/onStart already work.
import { useState } from "react";
import type { VAAssignedTask, AssignedTaskStatus } from "../lib/tasks";
import RevisionBadge from "./RevisionBadge";

type ViewTab = "assigned" | "available";

interface TasksPanelProps {
  tasks: VAAssignedTask[];
  loading: boolean;
  availableTasks: VAAssignedTask[];
  availableLoading: boolean;
  selectedId: number | null;
  onSelect: (task: VAAssignedTask) => void;
  acceptingId: number | null;
  onAccept: (task: VAAssignedTask) => void;
  startingId: number | null;
  onStart: (task: VAAssignedTask) => void;
  reworkingId: number | null;
  onRework: (task: VAAssignedTask) => void;
  onSubmit: (task: VAAssignedTask) => void;
  onReorder: (source: VAAssignedTask, target: VAAssignedTask) => void;
}

function statusBadge(status: AssignedTaskStatus) {
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
    case "revision_needed":
      return (
        <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-amber-50 text-amber-600 border border-amber-200">
          Revision Needed
        </span>
      );
    default:
      return null;
  }
}

export default function TasksPanel({
  tasks,
  loading,
  availableTasks,
  availableLoading,
  selectedId,
  onSelect,
  acceptingId,
  onAccept,
  startingId,
  onStart,
  reworkingId,
  onRework,
  onSubmit,
  onReorder,
}: TasksPanelProps) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("assigned");

  const isAssignedTab = viewTab === "assigned";
  const visibleTasks = isAssignedTab ? tasks : availableTasks;
  const isLoading = isAssignedTab ? loading : availableLoading;

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setViewTab("assigned")}
          className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
            isAssignedTab ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
          }`}
        >
          Assigned{tasks.length > 0 ? ` (${tasks.length})` : ""}
        </button>
        <button
          onClick={() => setViewTab("available")}
          className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
            !isAssignedTab ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
          }`}
        >
          Available{availableTasks.length > 0 ? ` (${availableTasks.length})` : ""}
        </button>
      </div>

      <div className="space-y-1.5 overflow-y-auto min-h-0">
        {isLoading ? (
          [1, 2, 3].map((i) => <div key={i} className="animate-pulse h-12 w-full bg-parchment rounded-lg" />)
        ) : visibleTasks.length === 0 ? (
          <p className="text-xs text-stone py-3 text-center">
            {isAssignedTab ? "No assigned tasks." : "No available tasks right now."}
          </p>
        ) : (
          visibleTasks.map((task) => {
            const detail = task.assigned_tasks;
            const isSelected = selectedId === task.id;
            const isStarting = startingId === task.id;
            const isFixedPay = detail.fixed_pay_task_id != null;
            const isAccepting = acceptingId === task.id;
            const isReworking = reworkingId === task.id;
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
                  if (!isAssignedTab || draggedId == null || draggedId === task.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverId !== task.id) setDragOverId(task.id);
                }}
                onDragLeave={() => setDragOverId((cur) => (cur === task.id ? null : cur))}
                onDrop={(e) => {
                  if (!isAssignedTab) return;
                  e.preventDefault();
                  const sourceId = draggedId;
                  setDraggedId(null);
                  setDragOverId(null);
                  if (sourceId == null || sourceId === task.id) return;
                  const source = visibleTasks.find((t) => t.id === sourceId);
                  // Same-status-group only — a cross-group drop would just be
                  // undone by the status-first sort on the next render.
                  if (source && source.status === task.status) onReorder(source, task);
                }}
              >
                <div className="flex items-start gap-1">
                  {/* Reserves the handle's width even while dragging, so the
                      title text doesn't jump. Pending tasks (Available tab)
                      aren't reorderable — no sort_order concept for them on
                      web either — so the handle is just blank space there. */}
                  <span
                    draggable={isAssignedTab}
                    onDragStart={(e) => {
                      if (!isAssignedTab) return;
                      setDraggedId(task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    title={isAssignedTab ? "Drag to reorder" : undefined}
                    className={`mt-[3px] shrink-0 w-[10px] h-[14px] flex items-center justify-center text-bark/40 transition-colors ${
                      isAssignedTab ? "cursor-grab active:cursor-grabbing hover:text-bark" : ""
                    }`}
                  >
                    {isAssignedTab && (
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

                    {task.status === "pending" && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => onAccept(task)}
                          disabled={isAccepting}
                          className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-[#a85840] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isAccepting ? "Accepting..." : "Accept"}
                        </button>
                      </div>
                    )}

                    {task.status === "revision_needed" && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => onRework(task)}
                          disabled={isReworking}
                          className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-terracotta text-white hover:bg-[#a85840] cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isReworking ? "Queuing..." : "Rework"}
                        </button>
                      </div>
                    )}

                    {task.status === "on_queue" && (
                      <div className="mt-1.5">
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
                      </div>
                    )}

                    {task.status === "in_progress" && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => onSubmit(task)}
                          className="flex items-center gap-1.5 text-[11px] font-semibold py-1 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 cursor-pointer transition-colors"
                        >
                          Submit
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
    </div>
  );
}
