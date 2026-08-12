// Client helpers for the per-task to-do checklist (task_todos table).
// Each item's "TD1"/"TD2" label is derived from its position (sort_order),
// not stored — see todoLabel below.

export type TaskTodo = {
  id: number;
  assigned_task_id: number;
  text: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  /** True if this VA has ever logged time against this to-do (any time_logs row with a matching todo_label). */
  played?: boolean;
};

export function todoLabel(sortOrder: number): string {
  return `TD${sortOrder + 1}`;
}

export async function fetchTodos(taskId: number): Promise<TaskTodo[]> {
  const res = await fetch(`/api/assigned-tasks/${taskId}/todos`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.todos ?? [];
}

export async function addTodo(taskId: number, text: string): Promise<TaskTodo | null> {
  const res = await fetch(`/api/assigned-tasks/${taskId}/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.todo ?? null;
}

export async function updateTodo(taskId: number, todoId: number, text: string): Promise<TaskTodo | null> {
  const res = await fetch(`/api/assigned-tasks/${taskId}/todos/${todoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.todo ?? null;
}

export async function deleteTodo(taskId: number, todoId: number): Promise<boolean> {
  const res = await fetch(`/api/assigned-tasks/${taskId}/todos/${todoId}`, { method: "DELETE" });
  return res.ok;
}

// Persists a full reordering: sends one PATCH per item with its new
// sort_order (position in orderedIds). Used after a drag-reorder.
export async function reorderTodos(taskId: number, orderedIds: number[]): Promise<void> {
  await Promise.all(
    orderedIds.map((todoId, index) =>
      fetch(`/api/assigned-tasks/${taskId}/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: index }),
      })
    )
  );
}
