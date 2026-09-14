import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { formatDateLocalTZ } from "@/lib/utils";

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
  /** Milliseconds logged in this round. */
  durationMs: number;
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
      .select("id, task_name, task_detail, account, review_required")
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

  const byUser: Record<string, SubmissionStat[]> = {};

  for (const row of rows) {
    if (row.message_type !== "submission") continue;
    if (!seesEveryone && row.user_id !== user.id) continue;

    const task = tasks.get(row.assigned_task_id);
    const revisions = revisionsByTask.get(row.assigned_task_id) ?? [];
    const round = revisions.filter((t) => t < row.created_at).length;

    // Logs of this round: the same rule the R badge uses, so the hours and
    // the round label can never disagree.
    const roundLogs = (logsByTask.get(row.assigned_task_id) ?? []).filter(
      (log) => revisions.filter((t) => t < log.start_time!).length === round
    );

    const durationMs = roundLogs.reduce((sum, l) => sum + Number(l.duration_ms ?? 0), 0);
    const firstStart = roundLogs.reduce<string | null>(
      (earliest, l) => (!earliest || l.start_time! < earliest ? l.start_time! : earliest),
      null
    );

    // No time logged against it — the submission date is all we have, and a
    // submission that exists has to land somewhere.
    const workStartDate = formatDateLocalTZ(firstStart ?? row.created_at, timezone);

    if (from && workStartDate < from) continue;
    if (to && workStartDate > to) continue;

    const list = byUser[row.user_id] ?? [];
    list.push({
      id: row.id,
      taskId: row.assigned_task_id,
      taskName: task?.task_name ?? null,
      taskDetail: task?.task_detail ?? null,
      account: task?.account ?? null,
      autoApproved: task?.review_required === false,
      round,
      submittedAt: row.created_at,
      workStartDate,
      durationMs,
    });
    byUser[row.user_id] = list;
  }

  return Response.json({ byUser, timezone });
}
