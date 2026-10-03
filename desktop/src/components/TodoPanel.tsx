// Right-hand column: the selected task's to-dos (TD1, TD2, ...) plus a
// description panel — the "To do" + "Todo Description" split from the
// wireframe. To-do rows, the TD label chip, and the Play button are copied
// from AssignedTasksWidget.tsx's to-do list (same ▶ icon, same sage/
// terracotta "playing" color swap) — Play starts/switches tracking against
// that specific to-do, via startAssignedTask's optional todoLabel param (see
// that file and App.tsx's handlePlayTodo). Not ported: the amber "played
// before" highlight AssignedTasksWidget also shows — that needs a separate
// time_logs lookup per to-do this app doesn't make yet; only the live
// "currently playing" state is here. Add/Edit/Delete are ported from
// TaskEditor.tsx's to-do checklist (src/lib/taskTodos.ts's addTodo/
// updateTodo/deleteTodo) — the web dashboard's own widget (AssignedTasksWidget)
// doesn't have these either; they live in the fuller task editor, which this
// app doesn't port wholesale, just this one piece of it.
//
// Local `todos` state rather than deriving straight from `task` each render:
// this app has no realtime, and the 30s task poll would otherwise be able to
// clobber an in-flight edit. Mutations (add/edit/delete) update this local
// copy directly on success; `onTodosChanged` tells App to refresh the task
// lists in the background so they're not stale next time one is reselected.
import { useEffect, useState } from "react";
import type { VAAssignedTask, TaskTodo } from "../lib/tasks";
import { todoLabel } from "../lib/tasks";
import { addTodo, updateTodo, deleteTodo } from "../lib/taskTodos";

interface TodoPanelProps {
  task: VAAssignedTask | null;
  onTodosChanged?: () => void;
  /** Which task/to-do is actively being clocked right now — drives the Play
   *  button's "Playing" state. Both null when nothing's running or it's
   *  plain task time with no to-do selected. */
  activeAssignedTaskId?: number | null;
  activeTodoLabel?: string | null;
  playingTodoId?: number | null;
  onPlayTodo?: (task: VAAssignedTask, todo: TaskTodo) => void;
}

const inputClass = "w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white";

export default function TodoPanel({
  task,
  onTodosChanged,
  activeAssignedTaskId = null,
  activeTodoLabel = null,
  playingTodoId = null,
  onPlayTodo,
}: TodoPanelProps) {
  const [todos, setTodos] = useState<TaskTodo[]>([]);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  // Clears the editor/composer only when the selection itself changes — not
  // on every poll, so switching tasks doesn't leave a stray edit box open on
  // the wrong one.
  useEffect(() => {
    setEditingId(null);
    setNewText("");
  }, [task?.id]);

  // Re-syncs `todos` from the task's own embedded list whenever App refreshes
  // it (App.tsx's loadTasks/loadAvailableTasks keep the selected task's object
  // itself current now — see that file's comment on why a frozen selection
  // used to go stale). Skipped while a text edit is open, so a poll can't
  // overwrite what's mid-typing; an in-flight Add is fine either way since it
  // only ever resolves to a superset of what's already showing.
  useEffect(() => {
    if (editingId !== null) return;
    setTodos(task?.assigned_tasks.task_todos ?? []);
  }, [task?.id, task?.assigned_tasks.task_todos, editingId]);

  if (!task) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4 flex-1 flex items-center justify-center">
        <p className="text-xs text-stone">Select a task on the left to see its to-dos.</p>
      </div>
    );
  }

  const detail = task.assigned_tasks;
  // Play only makes sense once a task is actually being worked — matches
  // AssignedTasksWidget.tsx, which shows its to-do list (and Play) only for
  // on_queue/in_progress. Add/Edit/Delete stay available regardless, same as
  // today, since the backend doesn't gate those on status either.
  const canPlay = Boolean(onPlayTodo) && (task.status === "on_queue" || task.status === "in_progress");

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const created = await addTodo(detail.id, text);
      if (created) {
        setTodos((prev) => [...prev, created]);
        setNewText("");
        onTodosChanged?.();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async (todoId: number) => {
    const text = editText.trim();
    if (!text) return;
    setBusyId(todoId);
    try {
      const updated = await updateTodo(detail.id, todoId, text);
      if (updated) {
        setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, text: updated.text } : t)));
        setEditingId(null);
        onTodosChanged?.();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (todoId: number) => {
    if (!confirm("Delete this to-do?")) return;
    setBusyId(todoId);
    try {
      const ok = await deleteTodo(detail.id, todoId);
      if (ok) {
        setTodos((prev) => prev.filter((t) => t.id !== todoId));
        onTodosChanged?.();
      }
    } finally {
      setBusyId(null);
    }
  };

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
                {editingId === todo.id ? (
                  <>
                    <span className="shrink-0 rounded bg-stone/10 px-1 py-0.5 text-[9px] font-bold text-stone">
                      {todoLabel(i)}
                    </span>
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveEdit(todo.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className={`${inputClass} flex-1 py-1`}
                    />
                    <button
                      onClick={() => void handleSaveEdit(todo.id)}
                      disabled={busyId === todo.id || !editText.trim()}
                      className="shrink-0 text-[10px] font-semibold text-sage hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="shrink-0 text-[10px] font-semibold text-stone hover:underline cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 rounded bg-stone/10 px-1 py-0.5 text-[9px] font-bold text-stone">
                      {todoLabel(i)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-espresso">{todo.text}</span>
                    {canPlay &&
                      (() => {
                        const label = todoLabel(i);
                        const isPlaying = activeAssignedTaskId === detail.id && activeTodoLabel === label;
                        return (
                          <button
                            onClick={() => onPlayTodo!(task, todo)}
                            disabled={playingTodoId === todo.id}
                            title={isPlaying ? `${label} is currently playing` : `Play ${label}`}
                            className={`shrink-0 flex items-center justify-center h-5 w-5 rounded cursor-pointer transition-colors disabled:opacity-50 ${
                              isPlaying ? "bg-terracotta text-white hover:bg-terracotta/90" : "bg-sage text-white hover:bg-sage/90"
                            }`}
                          >
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5,3 19,12 5,21" />
                            </svg>
                          </button>
                        );
                      })()}
                    <button
                      onClick={() => {
                        setEditingId(todo.id);
                        setEditText(todo.text);
                      }}
                      className="shrink-0 text-[10px] font-semibold text-slate-blue hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete(todo.id)}
                      disabled={busyId === todo.id}
                      className="shrink-0 text-[10px] font-semibold text-bark hover:text-terracotta transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 pt-1">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            placeholder="Add a to-do…"
            className={inputClass}
          />
          <button
            onClick={() => void handleAdd()}
            disabled={adding || !newText.trim()}
            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-soft text-amber text-[11px] font-semibold border border-amber/30 hover:bg-amber/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </div>
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
