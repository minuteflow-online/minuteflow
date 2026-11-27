import type { TaskSubmissionAttachment } from "@/lib/submissions";
import type { ReportShot } from "@/lib/screenshotReport";

/** One thread entry — a submission, revision request, approval, or note —
 *  joined to enough task context for the client Submissions hub. Mirrors the
 *  shape `/api/client-admin/submissions` returns, which itself mirrors the
 *  real `/api/submissions` feed. */
export type ClientFeedItem = {
  id: number;
  assigned_task_id: number | null;
  user_id: string | null;
  message_type: string;
  content: string;
  submission_link: string | null;
  submission_comment: string | null;
  created_at: string;
  edited_at: string | null;
  due_at: string | null;
  no_fault?: boolean | null;
  progress_status: "in_progress" | "completed" | null;
  attachments: TaskSubmissionAttachment[];
  sc_shots?: ReportShot[];
  profiles?: { id: string; full_name: string | null; username: string | null } | null;
  task: {
    id: number;
    task_name: string;
    task_detail: string | null;
    account: string | null;
    status: string | null;
    category: string | null;
    review_required: boolean | null;
    assigned_by: string | null;
    assigned_by_name: string | null;
    is_output_based: boolean;
    due_date: string | null;
    due_time: string | null;
    end_date: string | null;
    end_time: string | null;
  } | null;
};

/** Every entry for one task, oldest first — the original plus its resubmissions. */
export type ClientThread = { taskId: number; items: ClientFeedItem[]; latest: ClientFeedItem };

/** One task as it appears under one day — holds that day's round and every
 *  round before it, never a later one. */
export type ClientDayCard = { key: string; day: string; thread: ClientThread };

export type ClientPotentialTask = {
  task: {
    id: number;
    task_name: string;
    task_detail: string | null;
    account: string | null;
    category: string | null;
    assigned_by: string | null;
    is_output_based: boolean;
    due_date: string | null;
  };
  logs: Array<[string, string, number]>;
};

/** One day header's numbers, counted across every page. */
export type ClientDayStats = {
  submissionCount: number;
  needsReview: number;
  submittedMs: number;
  potentialMs: number;
  breakdown: string;
};

export type ClientViewMode = "timeline" | "calendar";

/** "1h 23m" / "45m" / "30s". */
export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "Nov 6" from a YYYY-MM-DD day key. */
export function formatDayKey(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Scope badge — every client-assigned task has no project_id, so this is
 *  always "Adhoc" today; kept as a function (not a constant) so it keeps
 *  working if client-side Objectives/Operations ever get built. */
export function scopeLabel(): string {
  return "Adhoc";
}
