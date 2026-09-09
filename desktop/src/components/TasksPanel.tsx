// On-queue / in-progress assigned tasks. Card, status badges, row layout,
// the Start button, and drag-to-reorder are all copied from
// AssignedTasksWidget.tsx (src/components/AssignedTasksWidget.tsx) and
// AGENTS.md's Status Badge / Task list item / Button patterns — same
// classes, same behavior. Drag state (draggedId/dragOverId) is ephemeral UI
// state kept local to this component, same as the web widget; the actual
// reorder (array splice + persist) is App's to do since it owns `tasks`,
// mirroring how onSelect/onStart already work.
import { useState } from "react";
import type { VAAssignedTask, AssignedTaskStatus } from "../lib/tasks";

interface TasksPanelProps {
  tasks: VAAssignedTask[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (task: VAAssignedTask) => void;
  startingId: number | null;
  onStart: (task: VAAssignedTask) => void;
  onReorder: (source: VAAssignedTask, target: VAAssignedTask) => void;
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
  onReorder,
}: TasksPanelProps) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-sand bg-white p-4 space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Tasks</h3>
        {tasks.length > 0 && (
          <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-terracotta-soft text-terracotta">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

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
                    className="mt-[3px] shrink-0 w-[10px] h-[14px] flex items-center justify-center cursor-grab active:cursor-grabbing text-bark/40 hover:text-bark transition-colors"
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
                    <button
                      onClick={() => onSelect(task)}
                      className="flex w-full items-start justify-between gap-2 text-left cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-espresso leading-tight">
                        {detail.task_detail || detail.task_name}
                      </span>
                      {statusBadge(task.status)}
                    </button>

                    {(detail.account || detail.project) && (
                      <button
                        onClick={() => onSelect(task)}
                        className="text-left text-[11px] text-stone/80 cursor-pointer"
                      >
                        {[detail.account, detail.project].filter(Boolean).join(" · ")}
                      </button>
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
