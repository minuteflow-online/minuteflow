// Right-hand column: the selected task's to-dos (TD1, TD2, ...) plus a
// description panel — the "To do" + "Todo Description" split from the
// wireframe. To-do rows and the TD label chip are copied from
// AssignedTasksWidget.tsx's to-do list; read-only here (no Play button —
// see tasks.ts for why status/todo mutations aren't wired up yet).
import type { VAAssignedTask } from "../lib/tasks";
import { todoLabel } from "../lib/tasks";

interface TodoPanelProps {
  task: VAAssignedTask | null;
}

export default function TodoPanel({ task }: TodoPanelProps) {
  if (!task) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 flex-1 flex items-center justify-center">
        <p className="text-xs text-stone">Select a task on the left to see its to-dos.</p>
      </div>
    );
  }

  const detail = task.assigned_tasks;
  const todos = detail.task_todos ?? [];

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="rounded-xl border border-sand bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">To Do</h3>
          <span className="text-[10px] font-semibold py-[2px] px-2 rounded-full bg-slate-blue-soft text-slate-blue">
            {detail.task_name}
          </span>
        </div>

        {todos.length === 0 ? (
          <p className="text-[11px] text-stone/50 italic py-2">No to-do items on this task.</p>
        ) : (
          <div className="space-y-1">
            {todos.map((todo, i) => (
              <div
                key={todo.id}
                className="flex items-center gap-1.5 rounded-md border border-sand bg-parchment/40 px-2 py-1.5"
              >
                <span className="shrink-0 rounded bg-stone/10 px-1 py-0.5 text-[9px] font-bold text-stone">
                  {todoLabel(i)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-espresso">{todo.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sand bg-white p-4 space-y-2 flex-1 min-h-0 overflow-y-auto">
        <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Todo Description</p>
        {detail.task_detail && (
          <p className="text-[12px] text-stone/80 leading-relaxed whitespace-pre-wrap">{detail.task_detail}</p>
        )}
        {detail.task_notes && (
          <div>
            <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase mt-2">Notes</p>
            <p className="text-[12px] text-stone/80 leading-relaxed whitespace-pre-wrap">{detail.task_notes}</p>
          </div>
        )}
        {detail.instructions && (
          <div>
            <p className="text-[10px] font-semibold text-walnut mb-0.5 tracking-wide uppercase mt-2">Instructions</p>
            <p className="text-[12px] text-stone/80 leading-relaxed whitespace-pre-wrap">{detail.instructions}</p>
          </div>
        )}
        {!detail.task_detail && !detail.task_notes && !detail.instructions && (
          <p className="text-[11px] text-stone/50 italic">No additional details.</p>
        )}
      </div>
    </div>
  );
}
