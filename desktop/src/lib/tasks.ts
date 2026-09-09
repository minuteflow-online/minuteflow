// Assigned tasks + their per-task to-dos, read directly from Supabase (RLS
// as the signed-in VA) rather than through /api/assigned-tasks — see the
// comment at the top of db.ts for why. This mirrors the exact select shape
// the API route uses for a VA (`vaSelectString` in
// src/app/api/assigned-tasks/route.ts) and AssignedTasksWidget's VA-visible
// status filter (on_queue, in_progress only).
//
// Reads bypass the API route (bearer auth below is only for the one PATCH
// this file needs); Accept/Submit and to-do edits still go through Next.js
// API routes that authenticate via the web app's cookie-based session and
// aren't wired up here yet — see the desktop app's README.
import { query, ensureAuth } from "./db";
import { API_BASE } from "./config";

export type AssignedTaskStatus =
  | "pending"
  | "on_queue"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "revision_needed"
  | "approved"
  | "completed"
  | "paid"
  | "cancelled";

export interface TaskTodo {
  id: number;
  text: string;
  sort_order: number;
}

export interface AssignedTaskDetail {
  id: number;
  account: string | null;
  project: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  instructions: string | null;
  due_date: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  /** Non-null means this task is paid a flat rate per completion rather than
   *  hourly — a different, instant-log start flow the desktop app doesn't
   *  implement yet (see startTask.ts). */
  fixed_pay_task_id: number | null;
  task_todos: TaskTodo[];
}

export interface VAAssignedTask {
  id: number;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  assigned_at: string;
  updated_at: string;
  /** Personal display order within a status group, set by dragging in
   *  TasksPanel — null until the VA has dragged this tile at least once.
   *  Mirrors AssignedTasksWidget.tsx's sort_order exactly. */
  sort_order: number | null;
  assigned_tasks: AssignedTaskDetail;
}

const VA_SELECT =
  "id,va_id,status,log_id,notes,assigned_at,updated_at,sort_order," +
  "assigned_tasks(id,account,project,task_name,task_detail,task_notes,instructions,due_date,archived_at,deleted_at,fixed_pay_task_id,task_todos(id,text,sort_order))";

const VA_VISIBLE_STATUSES: AssignedTaskStatus[] = ["on_queue", "in_progress"];

const STATUS_SORT_ORDER: Record<AssignedTaskStatus, number> = {
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

/** Mirrors AssignedTasksWidget.tsx's compareTasks: status group first, then
 *  each VA's own manual drag order within that group. A tile that's never
 *  been dragged (sort_order null) sorts after ones that have. */
function compareTasks(a: VAAssignedTask, b: VAAssignedTask): number {
  const statusDiff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
  if (statusDiff !== 0) return statusDiff;
  const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
}

function todoLabel(sortOrder: number): string {
  return `TD${sortOrder + 1}`;
}
export { todoLabel };

/** On-queue and in-progress tasks assigned to this VA, ordered the same way
 *  the web dashboard's Assigned Tasks widget shows them. */
export async function fetchAssignedTasks(userId: string): Promise<VAAssignedTask[]> {
  const statusList = VA_VISIBLE_STATUSES.join(",");
  const rows = await query<VAAssignedTask[]>("assigned_task_assignees", {
    filters: `va_id=eq.${userId}&status=in.(${statusList})&select=${VA_SELECT}`,
  });

  return rows
    .filter((t) => t.assigned_tasks && !t.assigned_tasks.archived_at && !t.assigned_tasks.deleted_at)
    .map((t) => ({
      ...t,
      assigned_tasks: {
        ...t.assigned_tasks,
        task_todos: [...(t.assigned_tasks.task_todos ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      },
    }))
    .sort(compareTasks);
}

/**
 * Persists a drag-to-reorder. Same endpoint AssignedTasksWidget's
 * persistOrder posts to, scoped server-side to the caller's own rows — see
 * that route's comment. `orderedIds` are assigned_task_assignees.id values
 * (task.id here), in the desired display order within one status group.
 */
export async function reorderAssignedTasks(orderedIds: number[]): Promise<boolean> {
  const session = await ensureAuth();
  if (!session) return false;

  try {
    const res = await fetch(`${API_BASE}/api/assigned-tasks/reorder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderedIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Single write path for an assignee status change — mirrors
 * src/lib/assignedTaskStatus.ts exactly (same endpoint, same body shape), the
 * one difference being the bearer token this app has to send in place of a
 * browser cookie. PATCH /api/assigned-tasks/[id] accepts it now (see that
 * route's bearerToken handling) specifically so this stays the single path
 * both apps funnel through, rather than a second hand-rolled one that can
 * drift from it — that drift is exactly what the web app's own comment on
 * setAssignedTaskStatus warns caused bugs before.
 */
export async function setAssignedTaskStatus(params: {
  assignedTaskId: number;
  status: AssignedTaskStatus;
  vaId: string;
  logId?: number | null;
}): Promise<boolean> {
  const session = await ensureAuth();
  if (!session) return false;

  try {
    const body: Record<string, unknown> = { status: params.status, va_id: params.vaId };
    if (params.logId != null) body.log_id = params.logId;

    const res = await fetch(`${API_BASE}/api/assigned-tasks/${params.assignedTaskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
