// On-queue / in-progress assigned tasks. Card, status badges, row layout and
// the Start button are all copied from AssignedTasksWidget.tsx
// (src/components/AssignedTasksWidget.tsx) and AGENTS.md's Status Badge /
// Task list item / Button patterns — same classes, same behavior (Start
// flips the assignee row to in_progress and begins tracking time against it;
// see startTask.ts). Accept/Submit and to-do edits aren't wired up yet — see
// tasks.ts.
import type { VAAssignedTask, AssignedTaskStatus } from "../lib/tasks";

interface TasksPanelProps {
  tasks: VAAssignedTask[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (task: VAAssignedTask) => void;
  startingId: number | null;
  onStart: (task: VAAssignedTask) => void;
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

export default function TasksPanel({ tasks, loading, selectedId, onSelect, startingId, onStart }: TasksPanelProps) {
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

            return (
              <div
                key={task.id}
                className={`flex flex-col gap-1.5 py-2.5 px-3 rounded-lg border transition-colors ${
                  isSelected ? "border-terracotta bg-cream" : "border-sand bg-white hover:bg-cream"
                }`}
              >
                <button
                  onClick={() => onSelect(task)}
                  className="flex items-start justify-between gap-2 text-left cursor-pointer"
                >
                  <span className="text-[13px] font-semibold text-espresso leading-tight">
                    {detail.task_detail || detail.task_name}
                  </span>
                  {statusBadge(task.status)}
                </button>

                {(detail.account || detail.project) && (
                  <button onClick={() => onSelect(task)} className="text-left text-[11px] text-stone/80 cursor-pointer">
                    {[detail.account, detail.project].filter(Boolean).join(" · ")}
                  </button>
                )}

                {task.status === "on_queue" && (
                  <div className="mt-0.5">
                    <button
                      onClick={() => onStart(task)}
                      disabled={isStarting || isFixedPay}
                      title={isFixedPay ? "Fixed-pay tasks aren't supported here yet — start from the web app." : undefined}
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
            );
          })
        )}
      </div>
    </div>
  );
}
