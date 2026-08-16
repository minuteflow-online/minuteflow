import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { canReviewSubmissions } from "@/lib/submissions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

/**
 * GET /api/submissions — the harvest feed behind Productivity → Submissions.
 *
 * Every `message_type = 'submission'` row across all assigned tasks, newest
 * first, joined to the task and its project so the hub can group by Objective,
 * Operation, or Adhoc (a task with no project_id at all).
 *
 * Query params — all optional:
 *   va=<uuid>                       only this person's submissions
 *   scope=objective|operation|adhoc filter by where the task lives
 *   projectId=<uuid>                narrow to one objective/operation
 *   from=YYYY-MM-DD&to=YYYY-MM-DD   date window (the calendar view's month)
 *
 * Admin-equivalent callers see everyone; everyone else sees only their own,
 * regardless of the `va` param.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();

  const isAdminEquivalent =
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    hasAdminPermission(profile, "task_management");

  const { searchParams } = new URL(request.url);
  const va = searchParams.get("va");
  const scope = searchParams.get("scope");
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let query = admin
    .from("task_submissions")
    .select(
      "id, assigned_task_id, user_id, message_type, content, submission_link, submission_comment, created_at, edited_at, edited_by, " +
        "profiles!task_submissions_user_id_profiles_fkey(id, full_name, username), " +
        "assigned_tasks!task_submissions_assigned_task_id_fkey(id, task_name, account, project, project_id, status, due_date, due_time, end_date, end_time, created_at, projects(id, name, kind))"
    )
    // The whole thread, not just submissions: revision notes, approvals and
    // added notes all belong in the timeline alongside the work.
    .not("assigned_task_id", "is", null)
    .order("created_at", { ascending: false });

  if (!isAdminEquivalent) {
    query = query.eq("user_id", user.id);
  } else if (va && va !== "all") {
    query = query.eq("user_id", va);
  }

  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type Row = Record<string, unknown> & {
    id: number;
    assigned_tasks?: {
      id: number;
      task_name: string;
      account: string | null;
      project: string | null;
      project_id: string | null;
      status: string | null;
      due_date: string | null;
      due_time: string | null;
      end_date: string | null;
      end_time: string | null;
      created_at: string | null;
      projects?: { id: string; name: string; kind: string } | null;
    } | null;
  };

  // Scope and project filtering happen here rather than in the query: "adhoc"
  // is the absence of a project link, which PostgREST can't express as a
  // filter on the embedded projects row.
  let rows = (data ?? []) as unknown as Row[];

  if (projectId && projectId !== "all") {
    rows = rows.filter((r) => r.assigned_tasks?.project_id === projectId);
  } else if (scope === "adhoc") {
    rows = rows.filter((r) => !r.assigned_tasks?.project_id);
  } else if (scope === "objective" || scope === "operation") {
    rows = rows.filter((r) => r.assigned_tasks?.projects?.kind === scope);
  }

  const submissionIds = rows.map((r) => r.id);
  const filesBySubmission = new Map<number, Array<Record<string, unknown>>>();

  if (submissionIds.length > 0) {
    const { data: files } = await admin
      .from("assigned_task_attachments")
      .select("id, submission_id, filename, storage_path, file_size, mime_type")
      .in("submission_id", submissionIds);

    await Promise.all(
      (files ?? []).map(async (file) => {
        const { data: signed } = await admin.storage
          .from("task-attachments")
          .createSignedUrl(file.storage_path as string, 3600);
        const list = filesBySubmission.get(file.submission_id as number) ?? [];
        list.push({ ...file, url: signed?.signedUrl ?? null });
        filesBySubmission.set(file.submission_id as number, list);
      })
    );
  }

  // ── Time spent per revision round ────────────────────────────────────────
  // A log belongs to round N when N revisions had been issued before it
  // started — the same rule the R badge uses, so the timing and the label can
  // never disagree. Round 0 is the original work, 1 is the first rework, etc.
  const taskIds = Array.from(
    new Set(rows.map((r) => r.assigned_tasks?.id).filter((v): v is number => v != null))
  );
  const roundDurations: Record<number, Record<number, number>> = {};
  /** taskId -> "awaiting" | "revision_requested" | "approved" */
  const reviewState: Record<number, string> = {};

  if (taskIds.length > 0) {
    const taskMeta = new Map<
      number,
      { name: string | null; account: string | null; createdAt: string | null }
    >();
    for (const row of rows) {
      if (row.assigned_tasks) {
        taskMeta.set(row.assigned_tasks.id, {
          name: row.assigned_tasks.task_name,
          account: row.assigned_tasks.account,
          createdAt: row.assigned_tasks.created_at,
        });
      }
    }

    const names = Array.from(
      new Set(
        Array.from(taskMeta.values())
          .map((m) => m.name)
          .filter((n): n is string => Boolean(n))
      )
    );

    const [revisionRes, assigneeRes, logRes] = await Promise.all([
      // Every thread entry, not just revisions: the newest one also tells us
      // whether the task is still awaiting review (see reviewState below).
      admin
        .from("task_submissions")
        .select("assigned_task_id, message_type, created_at")
        .in("assigned_task_id", taskIds),
      admin
        .from("assigned_task_assignees")
        .select("assigned_task_id, va_id")
        .in("assigned_task_id", taskIds),
      names.length > 0
        ? admin
            .from("time_logs")
            .select("user_id, task_name, account, start_time, duration_ms")
            .in("task_name", names)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const allEntries = (revisionRes.data ?? []) as Array<{
      assigned_task_id: number;
      message_type: string;
      created_at: string;
    }>;

    const revisionTimes = new Map<number, string[]>();
    for (const r of allEntries) {
      if (r.message_type !== "revision") continue;
      revisionTimes.set(r.assigned_task_id, (revisionTimes.get(r.assigned_task_id) ?? []).concat(r.created_at));
    }

    // The newest submission/revision/approval decides where a task stands.
    // Derived from the thread rather than assigned_tasks.status, which isn't
    // synced when an admin issues a revision and so can't be trusted here.
    const latestByTask = new Map<number, { message_type: string; created_at: string }>();
    for (const entry of allEntries) {
      if (!["submission", "revision", "approval", "approval_reversed"].includes(entry.message_type))
        continue;
      const current = latestByTask.get(entry.assigned_task_id);
      if (!current || entry.created_at > current.created_at) {
        latestByTask.set(entry.assigned_task_id, entry);
      }
    }
    for (const [taskId, entry] of latestByTask) {
      reviewState[taskId] =
        entry.message_type === "revision"
          ? "revision_requested"
          : entry.message_type === "approval"
            ? "approved"
            : // submission, or an approval that was reversed — either way it's
              // back in front of a reviewer.
              "awaiting";
    }

    const vasByTask = new Map<number, string[]>();
    for (const a of assigneeRes.data ?? []) {
      const id = a.assigned_task_id as number;
      vasByTask.set(id, (vasByTask.get(id) ?? []).concat(a.va_id as string));
    }

    // time_logs carry no task reference, so a log is matched to its task by
    // person + task name + account.
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    const logs = (logRes.data ?? []) as Array<{
      user_id: string;
      task_name: string | null;
      account: string | null;
      start_time: string | null;
      duration_ms: number | null;
    }>;

    for (const taskId of taskIds) {
      const meta = taskMeta.get(taskId);
      if (!meta) continue;
      const vas = vasByTask.get(taskId) ?? [];
      const times = (revisionTimes.get(taskId) ?? []).slice().sort();
      const buckets: Record<number, number> = {};

      for (const log of logs) {
        if (!log.start_time) continue;
        if (!vas.includes(log.user_id)) continue;
        if (norm(log.task_name) !== norm(meta.name)) continue;
        if (norm(log.account) !== norm(meta.account)) continue;
        // Work on a task can't predate the task. Without this, older logs that
        // merely share a name and account (recurring work often does) get
        // swallowed into round 0 and inflate the original-effort figure.
        if (meta.createdAt && log.start_time < meta.createdAt) continue;
        const round = times.filter((t) => t < log.start_time!).length;
        buckets[round] = (buckets[round] ?? 0) + Number(log.duration_ms ?? 0);
      }

      if (Object.keys(buckets).length > 0) roundDurations[taskId] = buckets;
    }
  }

  const submissions = rows.map((row) => {
    const task = row.assigned_tasks;
    const { assigned_tasks: _omit, ...rest } = row;
    void _omit;
    return {
      ...rest,
      attachments: filesBySubmission.get(row.id) ?? [],
      task: task
        ? {
            id: task.id,
            task_name: task.task_name,
            account: task.account,
            project: task.project,
            project_id: task.project_id,
            project_kind: task.projects?.kind ?? null,
            project_name: task.projects?.name ?? null,
            status: task.status,
            due_date: task.due_date,
            due_time: task.due_time,
            end_date: task.end_date,
            end_time: task.end_time,
          }
        : null,
    };
  });

  // `seesAll` is the broader admin-equivalent tier (who may view everyone's
  // submissions); `canReview` is the narrower Admin/CEO/Founder tier the POST
  // route actually enforces — returning the same flag for both would render
  // Approve buttons that 403 for a Manager.
  return Response.json({
    submissions,
    roundDurations,
    reviewState,
    seesAll: isAdminEquivalent,
    canReview: canReviewSubmissions(profile),
  });
}
