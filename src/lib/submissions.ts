// Work submissions for `assigned_tasks`.
//
// These live in `task_submissions`, the same append-only thread table the
// legacy `va_task_assignments` flow already uses — a row carries EITHER
// `va_task_assignment_id` (legacy) or `assigned_task_id` (this flow), never
// both, enforced by the `task_submissions_target_ck` check constraint.
//
// A submission is immutable to the VA who wrote it: the RLS update policy for
// role="va" was dropped, so once saved they can only append another row to the
// thread. Admin/CEO/Founder can still correct one, and the
// `task_submissions_stamp_edit` trigger stamps `edited_at`/`edited_by` when
// they do.

export type SubmissionMessageType =
  | "instruction"
  | "submission"
  | "revision"
  | "approval"
  /** Undoes a mistaken approval. Appended, never a delete — the approval stays
   *  in the record and the reversal sits after it. */
  | "approval_reversed"
  | "comment";

export interface TaskSubmissionAttachment {
  id: number;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  url: string | null;
}

export interface TaskSubmission {
  id: number;
  assigned_task_id: number | null;
  user_id: string;
  message_type: SubmissionMessageType;
  content: string;
  submission_link: string | null;
  submission_comment: string | null;
  created_at: string;
  edited_at: string | null;
  edited_by: string | null;
  attachments: TaskSubmissionAttachment[];
  profiles?: { id: string; full_name: string | null; username: string | null } | null;
}

/** A submission row joined to enough task context for the hub's list/calendar. */
export interface SubmissionFeedItem extends TaskSubmission {
  task: {
    id: number;
    task_name: string;
    account: string | null;
    project: string | null;
    project_id: string | null;
    /** "objective" | "operation", or null when the task belongs to no project. */
    project_kind: SubmissionScope | null;
    project_name: string | null;
  };
}

/**
 * Where a submitted task came from. "adhoc" is the absence of a link — a task
 * created outside any Objective or Operation (`assigned_tasks.project_id` is
 * null), which is why it can't be expressed as a project kind.
 */
export type SubmissionScope = "objective" | "operation";
export type SubmissionScopeFilter = SubmissionScope | "adhoc" | "all";

/**
 * Who may review a submission (approve / request revision) or correct a saved
 * one: "Admin and above" — Admin, Manager, CEO, Founder.
 *
 * This list is deliberately standalone and NOT an alias of hasModerationAccess()
 * or hasBroadAdminAccess(), even though it currently overlaps one of them. The
 * tier was chosen for this feature specifically, so retiering Feedback or Bug
 * Report moderation later must not silently change who can approve submitted
 * work. Change this list only when the answer for *submissions* changes.
 *
 * Note it excludes Coordinator and Specialist, and it does not grant on
 * department: an Accounting Specialist reaches financials via
 * hasFinancialAccess(), which is a separate question from reviewing work.
 */
export const SUBMISSION_REVIEW_ROLES = ["admin", "manager", "ceo", "founder"] as const;

export function canReviewSubmissions(
  profile?: { role?: string | null } | null
): boolean {
  if (!profile?.role) return false;
  return (SUBMISSION_REVIEW_ROLES as readonly string[]).includes(profile.role);
}

/**
 * Emptying the trash is the only destructive action in this feature: it
 * permanently removes submissions and their files, with no undo. Founder only
 * — deliberately narrower than SUBMISSION_REVIEW_ROLES, which can trash but
 * not destroy.
 */
export function canEmptySubmissionTrash(
  profile?: { role?: string | null } | null
): boolean {
  return profile?.role === "founder";
}

export const SUBMISSION_TYPE_LABELS: Record<SubmissionMessageType, string> = {
  instruction: "Instruction",
  submission: "Submission",
  revision: "Revision requested",
  approval: "Approved",
  approval_reversed: "Approval reversed",
  comment: "Note",
};

/** Badge classes per thread entry type, matching the app's status-badge shape. */
export const SUBMISSION_TYPE_BADGE: Record<SubmissionMessageType, string> = {
  instruction: "bg-slate-blue-soft text-slate-blue border-slate-blue/20",
  submission: "bg-sky-50 text-sky-600 border-sky-200",
  revision: "bg-amber-50 text-amber-600 border-amber-200",
  approval: "bg-emerald-50 text-emerald-600 border-emerald-200",
  approval_reversed: "bg-terracotta-soft text-terracotta border-terracotta/20",
  comment: "bg-stone/10 text-stone border-stone/20",
};

/**
 * Builds the `content` column for a submission. It's NOT NULL and is what the
 * timeline shows as the entry's headline, so a submission that carries only a
 * link or only files still gets a readable one-liner instead of an empty cell.
 */
export function submissionSummary({
  message,
  link,
  fileCount,
}: {
  message?: string | null;
  link?: string | null;
  fileCount: number;
}): string {
  const trimmed = message?.trim();
  if (trimmed) return trimmed;
  if (link?.trim()) return link.trim();
  if (fileCount === 1) return "Submitted 1 attachment";
  if (fileCount > 1) return `Submitted ${fileCount} attachments`;
  return "Submitted";
}

/** Fetches the full thread for one assigned task, oldest first. */
export async function fetchSubmissions(assignedTaskId: number): Promise<TaskSubmission[]> {
  try {
    const res = await fetch(`/api/assigned-tasks/${assignedTaskId}/submissions`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.submissions ?? [];
  } catch {
    return [];
  }
}
