import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { computeSubmissionRounds } from "@/lib/submissionRounds";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

/**
 * GET /api/team-submissions?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Submissions for the Insights → Team report, dated by when the work on them
 * STARTED rather than when they were handed in.
 *
 * That distinction is the whole point: someone can start a piece on Monday,
 * break the hours across two days and submit it Tuesday. Counting it on
 * Tuesday makes Monday look idle and Tuesday look twice as productive. A
 * revision is the same story one round later — it belongs to the day the
 * rework began, not the day the reviewer asked for it.
 *
 * Rounds use the same rule as the Submissions hub: a time log belongs to
 * round N when N revisions had been issued before it started. Round 0 is the
 * original work. So the hours reported against a submission are the hours
 * logged in its own round, never the whole task's history.
 *
 * Returns { byUser: { [userId]: SubmissionStat[] }, timezone }.
 */

type SubmissionStat = {
  id: number;
  taskId: number;
  taskName: string | null;
  taskDetail: string | null;
  account: string | null;
  /** Nobody reviews this one — it is approved on submit. */
  autoApproved: boolean;
  /** 0 = original work, 1 = first rework, and so on. */
  round: number;
  submittedAt: string;
  /** Local date (org timezone) the work for this round started. */
  workStartDate: string;
  /** Milliseconds worked in this round. */
  durationMs: number;
  /** Where that figure came from — see computeSubmissionRounds. */
  timeSource: "logged" | "scheduled" | "none" | "counted";
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const seesEveryone =
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "ceo" ||
    profile?.role === "founder" ||
    hasAdminPermission(profile, "task_management");

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgRow } = await admin
    .from("organization_settings")
    .select("timezone")
    .limit(1)
    .single();
  const timezone = orgRow?.timezone || "UTC";

  // The whole thread, not just the submissions: the revision entries are what
  // divide a task's logs into rounds.
  const { data: entries, error: entryError } = await admin
    .from("task_submissions")
    .select("id, assigned_task_id, user_id, message_type, created_at")
    .in("message_type", ["submission", "revision"])
    .is("deleted_at", null)
    .not("assigned_task_id", "is", null)
    .limit(20000);

  if (entryError) return Response.json({ error: entryError.message }, { status: 500 });

  type Entry = {
    id: number;
    assigned_task_id: number;
    user_id: string;
    message_type: string;
    created_at: string;
  };
  const rows = (entries ?? []) as Entry[];
  const taskIds = [...new Set(rows.map((r) => r.assigned_task_id))];

  if (taskIds.length === 0) return Response.json({ byUser: {}, timezone });

  const [taskRes, logRes] = await Promise.all([
    admin
      .from("assigned_tasks")
      .select(
        "id, task_name, task_detail, account, review_required, fixed_pay_task_id, start_time, end_time, planned_minutes"
      )
      .in("id", taskIds)
      .limit(20000),
    // Logs name the task they were worked under, so the hours for a round are
    // exactly the logs that fall inside it — no matching on task name, which
    // counted one session against every recurring instance sharing a name.
    admin
      .from("time_logs")
      .select("assigned_task_id, start_time, duration_ms")
      .in("assigned_task_id", taskIds)
      .is("deleted_at", null)
      .limit(50000),
  ]);

  type TaskRow = {
    id: number;
    task_name: string | null;
    task_detail: string | null;
    account: string | null;
    review_required: boolean | null;
    fixed_pay_task_id: number | null;
    start_time: string | null;
    end_time: string | null;
    planned_minutes: number | null;
  };
  const tasks = new Map<number, TaskRow>(
    ((taskRes.data ?? []) as TaskRow[]).map((t) => [t.id, t])
  );

  type LogRow = {
    assigned_task_id: number | null;
    start_time: string | null;
    duration_ms: number | null;
  };
  const logsByTask = new Map<number, LogRow[]>();
  for (const log of (logRes.data ?? []) as LogRow[]) {
    if (log.assigned_task_id == null || !log.start_time) continue;
    const list = logsByTask.get(log.assigned_task_id) ?? [];
    list.push(log);
    logsByTask.set(log.assigned_task_id, list);
  }

  // Revision timestamps per task, oldest first — the round boundaries.
  const revisionsByTask = new Map<number, string[]>();
  for (const row of rows) {
    if (row.message_type !== "revision") continue;
    const list = revisionsByTask.get(row.assigned_task_id) ?? [];
    list.push(row.created_at);
    revisionsByTask.set(row.assigned_task_id, list);
  }
  for (const list of revisionsByTask.values()) list.sort();

  // Grouped by task, because a round's hours are decided across all of that
  // task's submissions at once — two hand-ins inside one round must not each
  // claim the same time.
  const submissionsByTask = new Map<number, Entry[]>();
  for (const row of rows) {
    if (row.message_type !== "submission") continue;
    submissionsByTask.set(
      row.assigned_task_id,
      (submissionsByTask.get(row.assigned_task_id) ?? []).concat(row)
    );
  }

  const byUser: Record<string, SubmissionStat[]> = {};

  for (const [taskId, taskSubmissions] of submissionsByTask) {
    const task = tasks.get(taskId);
    const results = computeSubmissionRounds({
      submissions: taskSubmissions.map((s) => ({ id: s.id, created_at: s.created_at })),
      revisions: (revisionsByTask.get(taskId) ?? []).map((created_at) => ({ created_at })),
      logs: (logsByTask.get(taskId) ?? []).map((l) => ({
        start_time: l.start_time!,
        duration_ms: l.duration_ms,
      })),
      task: {
        isOutputBased: task?.fixed_pay_task_id != null,
        scheduledStart: task?.start_time ?? null,
        scheduledEnd: task?.end_time ?? null,
        plannedMinutes: task?.planned_minutes ?? null,
      },
      timezone,
    });

    const submittedBy = new Map(taskSubmissions.map((s) => [s.id, s.user_id]));

    for (const result of results) {
      const userId = submittedBy.get(result.submissionId);
      if (!userId) continue;
      if (!seesEveryone && userId !== user.id) continue;
      if (from && result.workStartDate < from) continue;
      if (to && result.workStartDate > to) continue;

      const entry = taskSubmissions.find((s) => s.id === result.submissionId)!;
      const list = byUser[userId] ?? [];
      list.push({
        id: result.submissionId,
        taskId,
        taskName: task?.task_name ?? null,
        taskDetail: task?.task_detail ?? null,
        account: task?.account ?? null,
        autoApproved: task?.review_required === false,
        round: result.round,
        submittedAt: entry.created_at,
        workStartDate: result.workStartDate,
        durationMs: result.durationMs,
        timeSource: result.timeSource,
      });
      byUser[userId] = list;
    }
  }

  return Response.json({ byUser, timezone });
}
