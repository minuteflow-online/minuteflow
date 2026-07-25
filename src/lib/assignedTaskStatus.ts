import type { AssignedTaskStatus } from "@/types/database";

/**
 * Single source of truth for writing an assigned-task status change from the client.
 *
 * Every Start / Submit / Accept action in the app funnels through here so the request
 * shape is identical for every case (VA vs admin, hourly vs fixed pay, project-created
 * vs directly-assigned). Historically each of those cases had its own hand-rolled fetch
 * with a slightly different body, which is why the Start -> Submit transition kept
 * breaking for one subset at a time.
 *
 * The body always carries `va_id` so the API can unambiguously resolve the
 * `assigned_task_assignees` row to update, for every role.
 */
export interface SetAssignedTaskStatusArgs {
  /** id of the parent `assigned_tasks` row (NOT the assignee row id). */
  assignedTaskId: number;
  /** Status to write to the acting user's assignee row. */
  status: AssignedTaskStatus;
  /** The acting user's id — the assignee row being updated. */
  vaId: string;
  /** `time_logs` id to link when the change is driven by starting a task. */
  logId?: number | null;
}

/** Returns true when the server accepted the status change. Never throws. */
export async function setAssignedTaskStatus({
  assignedTaskId,
  status,
  vaId,
  logId,
}: SetAssignedTaskStatusArgs): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { status, va_id: vaId };
    if (logId != null) body.log_id = logId;

    const res = await fetch(`/api/assigned-tasks/${assignedTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `setAssignedTaskStatus(${assignedTaskId} -> ${status}) failed: ${res.status} ${detail}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`setAssignedTaskStatus(${assignedTaskId} -> ${status}) threw`, err);
    return false;
  }
}
