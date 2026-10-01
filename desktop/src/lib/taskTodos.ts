// Add/edit/delete a task's to-do items. Mirrors src/lib/taskTodos.ts's
// addTodo/updateTodo/deleteTodo — same endpoints, bearer auth in place of the
// cookie session. No fetchTodos here: desktop's VA_SELECT (tasks.ts) already
// embeds task_todos on every assigned/available task, so there's no separate
// read to port. No reorderTodos either — drag-reordering to-dos isn't
// supported here, only the task-level drag-reorder tasks.ts already has.
import { ensureAuth } from "./db";
import { API_BASE } from "./config";
import type { TaskTodo } from "./tasks";

export async function addTodo(assignedTaskId: number, text: string): Promise<TaskTodo | null> {
  const session = await ensureAuth();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/${assignedTaskId}/todos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.todo ?? null;
  } catch {
    return null;
  }
}

export async function updateTodo(assignedTaskId: number, todoId: number, text: string): Promise<TaskTodo | null> {
  const session = await ensureAuth();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/${assignedTaskId}/todos/${todoId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.todo ?? null;
  } catch {
    return null;
  }
}

export async function deleteTodo(assignedTaskId: number, todoId: number): Promise<boolean> {
  const session = await ensureAuth();
  if (!session) return false;
  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/${assignedTaskId}/todos/${todoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
