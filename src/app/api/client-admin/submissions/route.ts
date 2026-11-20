import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnreadCandidate } from "@/lib/submissionUnread";
import { placeShotsByWork } from "@/lib/submissionTime";

export const dynamic = "force-dynamic";

type AdminClient = SupabaseClient;

/**
 * This route mirrors `/api/submissions` (the real Productivity → Submissions
 * feed) almost field-for-field, so the client-facing UI can reuse the same
 * grouping/badge/time-allocation logic the real page uses. The one thing
 * that's genuinely simpler here: scoping. The real route branches on
 * admin-vs-VA role and stitches together "my own rows OR rows I assigned OR
 * rows on tasks I'm an assignee of". A client has none of that — they see
 * every task in their own org and nothing else, full stop, so every loader
 * below just filters by `assigned_tasks.organization_id`.
 *
 * Deliberately NOT shared code with `/api/submissions/route.ts` — that file
 * is a live, heavily-used route with its own admin/VA branching, and copying
 * its logic here (rather than importing from it) keeps this feature from
 * ever risking a change to that path. See the `submissions-feed` duplication
 * note in CLAUDE.md's spirit: if the real route's query shape changes,
 * check this file too.
 */

/** PostgREST truncates any response at 1000 rows, even past an explicit range. */
async function fetchAllPages<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: all, error };
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { data: all, error: null };
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function loadAttachments(
  admin: AdminClient,
  submissionIds: number[],
  rows: Array<Record<string, unknown> & { id: number; assigned_tasks?: { id: number } | null }>
) {
  const filesBySubmission = new Map<number, Array<Record<string, unknown>>>();
  if (submissionIds.length === 0) return filesBySubmission;

  const select = "id, submission_id, filename, storage_path, file_size, mime_type, kind";
  const fetchAll = async (
    page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  ) => (await fetchAllPages(page)).data;
  const idChunks: number[][] = [];
  for (let i = 0; i < submissionIds.length; i += 100) idChunks.push(submissionIds.slice(i, i + 100));
  const linkedPromise = Promise.all(
    idChunks.map((ids) =>
      fetchAll((from, to) =>
        admin.from("assigned_task_attachments").select(select).in("submission_id", ids).order("id").range(from, to)
      )
    )
  ).then((parts) => parts.flat());

  const latestByTaskUser = new Map<string, { id: number; created_at: string }>();
  for (const r of rows) {
    const taskId = r.assigned_tasks?.id;
    if (r.message_type !== "submission" || taskId == null) continue;
    const key = `${taskId}:${r.user_id}`;
    const createdAt = String(r.created_at);
    const current = latestByTaskUser.get(key);
    if (!current || createdAt > current.created_at) latestByTaskUser.set(key, { id: r.id, created_at: createdAt });
  }
  const taskIds = Array.from(new Set(Array.from(latestByTaskUser.keys()).map((k) => Number(k.split(":")[0]))));
  const [linked, unlinked] = await Promise.all([
    linkedPromise,
    taskIds.length > 0
      ? fetchAll((from, to) =>
          admin
            .from("assigned_task_attachments")
            .select(`${select}, assigned_task_id, uploaded_by`)
            .in("assigned_task_id", taskIds)
            .is("submission_id", null)
            .order("id")
            .range(from, to)
        )
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);
  const files: Array<Record<string, unknown>> = [...linked];
  for (const f of unlinked) {
    const target = latestByTaskUser.get(`${f.assigned_task_id}:${f.uploaded_by}`);
    if (target) files.push({ ...f, submission_id: target.id });
  }

  const now = Date.now();
  const urlByPath = new Map<string, string | null>();
  const toSign: string[] = [];
  for (const f of files) {
    const path = f.storage_path as string;
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) urlByPath.set(path, cached.url);
    else if (!urlByPath.has(path)) {
      urlByPath.set(path, null);
      toSign.push(path);
    }
  }
  const chunks: string[][] = [];
  for (let i = 0; i < toSign.length; i += 200) chunks.push(toSign.slice(i, i + 200));
  const signed = await Promise.all(
    chunks.map((chunk) => admin.storage.from("task-attachments").createSignedUrls(chunk, 3600))
  );
  if (signedUrlCache.size > 5000) signedUrlCache.clear();
  for (const s of signed.flatMap((r) => r.data ?? [])) {
    if (!s.path || !s.signedUrl) continue;
    urlByPath.set(s.path, s.signedUrl);
    signedUrlCache.set(s.path, { url: s.signedUrl, expiresAt: now + 50 * 60 * 1000 });
  }

  for (const file of files ?? []) {
    const list = filesBySubmission.get(file.submission_id as number) ?? [];
    list.push({ ...file, url: urlByPath.get(file.storage_path as string) ?? null });
    filesBySubmission.set(file.submission_id as number, list);
  }
  return filesBySubmission;
}

async function loadScreenshots(admin: AdminClient, submissionIds: number[]) {
  const reportBySubmission = new Map<number, Array<Record<string, unknown>>>();
  const reportLogs: Record<number, { start_time: string | null; end_time: string | null; category: string | null }> = {};
  if (submissionIds.length === 0) return { reportBySubmission, reportLogs };

  const idChunks: number[][] = [];
  for (let i = 0; i < submissionIds.length; i += 100) idChunks.push(submissionIds.slice(i, i + 100));
  const allRows = (
    await Promise.all(
      idChunks.map((ids) =>
        fetchAllPages((from, to) =>
          admin
            .from("task_screenshots")
            .select("id, submission_id, log_id, filename, drive_file_id, screenshot_type, failure_reason, created_at, captured_at, image_hash")
            .in("submission_id", ids)
            .order("id")
            .range(from, to)
        )
      )
    )
  ).flatMap((r) => r.data ?? []) as Array<Record<string, unknown>>;

  for (const s of allRows) {
    const sid = s.submission_id as number;
    const list = reportBySubmission.get(sid) ?? [];
    list.push(s);
    reportBySubmission.set(sid, list);
  }

  const logIds = Array.from(new Set(allRows.map((s) => s.log_id as number | null).filter((v): v is number => v != null)));
  for (let i = 0; i < logIds.length; i += 200) {
    const { data } = await admin.from("time_logs").select("id, start_time, end_time, category").in("id", logIds.slice(i, i + 200));
    for (const l of data ?? []) {
      reportLogs[l.id as number] = {
        start_time: (l.start_time as string | null) ?? null,
        end_time: (l.end_time as string | null) ?? null,
        category: (l.category as string | null) ?? null,
      };
    }
  }

  return { reportBySubmission, reportLogs };
}

function shotAttachment(s: Record<string, unknown>) {
  return {
    id: -(s.id as number),
    filename: (s.filename as string) || "screenshot.png",
    storage_path: "",
    file_size: null,
    mime_type: "image/png",
    url: `/api/drive-image?id=${s.drive_file_id}`,
    kind: "screenshot",
  };
}

async function loadRoundData(admin: AdminClient, taskIds: number[], completedTasks: Set<number>) {
  const taskSubmissions: Record<number, Array<{ id: number; created_at: string }>> = {};
  const taskLogs: Record<number, Array<[string | null, number | null]>> = {};
  const reviewState: Record<number, string> = {};
  const flaggedTasks: Record<number, boolean> = {};
  if (taskIds.length === 0) return { taskSubmissions, taskLogs, reviewState, flaggedTasks };

  const [revisionRes, logRes] = await Promise.all([
    fetchAllPages((from, to) =>
      admin
        .from("task_submissions")
        .select("id, assigned_task_id, message_type, created_at")
        .in("assigned_task_id", taskIds)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
    ),
    fetchAllPages((from, to) =>
      admin.from("time_logs").select("assigned_task_id, start_time, duration_ms").in("assigned_task_id", taskIds).order("id").range(from, to)
    ),
  ]);

  const allEntries = (revisionRes.data ?? []) as Array<{
    id: number;
    assigned_task_id: number;
    message_type: string;
    created_at: string;
  }>;

  for (const r of allEntries) {
    if (r.message_type !== "submission") continue;
    (taskSubmissions[r.assigned_task_id] ??= []).push({ id: r.id, created_at: r.created_at });
  }
  for (const list of Object.values(taskSubmissions)) list.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const latestByTask = new Map<number, { message_type: string; created_at: string }>();
  for (const entry of allEntries) {
    if (!["submission", "revision", "approval", "approval_reversed", "revision_reversed", "rejection", "rejection_reversed"].includes(entry.message_type)) continue;
    const current = latestByTask.get(entry.assigned_task_id);
    if (!current || entry.created_at > current.created_at) latestByTask.set(entry.assigned_task_id, entry);
  }

  const latestFlagMark = new Map<number, { message_type: string; created_at: string }>();
  for (const entry of allEntries) {
    if (!["flag", "flag_cleared", "submission", "revision", "approval", "approval_reversed", "revision_reversed", "rejection", "rejection_reversed"].includes(entry.message_type)) continue;
    const current = latestFlagMark.get(entry.assigned_task_id);
    if (!current || entry.created_at > current.created_at) latestFlagMark.set(entry.assigned_task_id, entry);
  }
  for (const [taskId, entry] of latestFlagMark) {
    if (entry.message_type === "flag" && !completedTasks.has(taskId)) flaggedTasks[taskId] = true;
  }

  for (const [taskId, entry] of latestByTask) {
    if (completedTasks.has(taskId)) {
      reviewState[taskId] = "completed";
      continue;
    }
    reviewState[taskId] =
      entry.message_type === "revision"
        ? "revision_requested"
        : entry.message_type === "approval"
          ? "approved"
          : entry.message_type === "rejection"
            ? "rejected"
            : "awaiting";
  }

  const logs = (logRes.data ?? []) as Array<{ assigned_task_id: number | null; start_time: string | null; duration_ms: number | null }>;
  for (const log of logs) {
    if (log.assigned_task_id == null || !log.start_time) continue;
    (taskLogs[log.assigned_task_id] ??= []).push([log.start_time, log.duration_ms]);
  }

  return { taskSubmissions, taskLogs, reviewState, flaggedTasks };
}

/** Org-scoped equivalent of the real route's loadExpectedWork — tasks due
 *  with nothing submitted yet, for the Calendar view's "Expected" chips. */
async function loadExpectedWork(admin: AdminClient, organizationId: string): Promise<Array<Record<string, unknown>>> {
  const expected: Array<Record<string, unknown>> = [];
  const OPEN_STATUSES = new Set(["unassigned", "pending", "on_queue", "in_progress", "revision_needed"]);

  const { data: dueTasks } = await fetchAllPages((from, to) =>
    admin
      .from("assigned_tasks")
      .select(
        "id, task_name, task_detail, account, project, project_id, status, due_date, due_time, end_date, end_time, category, review_required, assigned_by, fixed_pay_task_id, organization_id, " +
          "assigned_by_profile:profiles!assigned_tasks_assigned_by_fkey(id, full_name, username), assigned_task_assignees(id, va_id, status)"
      )
      .eq("organization_id", organizationId)
      .not("due_date", "is", null)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("id")
      .range(from, to)
  );

  type DueTask = {
    id: number;
    task_name: string;
    task_detail: string | null;
    account: string | null;
    project: string | null;
    project_id: string | null;
    status: string | null;
    due_date: string | null;
    due_time: string | null;
    end_date: string | null;
    end_time: string | null;
    category: string | null;
    review_required: boolean | null;
    assigned_by: string | null;
    fixed_pay_task_id: number | null;
    assigned_by_profile?: { id: string; full_name: string | null; username: string | null } | null;
    assigned_task_assignees?: Array<{ id: number; va_id: string | null; status: string | null }>;
  };

  const dueRows = ((dueTasks ?? []) as unknown as DueTask[]).filter((t) =>
    (t.assigned_task_assignees ?? []).some((a) => OPEN_STATUSES.has(a.status ?? ""))
  );

  const waitingOnIds = [
    ...new Set(dueRows.flatMap((t) => (t.assigned_task_assignees ?? []).map((a) => a.va_id)).filter((v): v is string => Boolean(v))),
  ];
  let people: Record<string, { id: string; full_name: string | null; username: string | null }> = {};
  if (waitingOnIds.length > 0) {
    const { data: peopleRows } = await admin.from("profiles").select("id, full_name, username").in("id", waitingOnIds);
    people = Object.fromEntries((peopleRows ?? []).map((p) => [p.id, p]));
  }

  for (const task of dueRows) {
    for (const assignee of task.assigned_task_assignees ?? []) {
      if (!OPEN_STATUSES.has(assignee.status ?? "") || !assignee.va_id) continue;
      expected.push({
        id: -assignee.id,
        assigned_task_id: task.id,
        user_id: assignee.va_id,
        message_type: "expected",
        content: "",
        submission_link: null,
        submission_comment: null,
        created_at: `${task.due_date}T${task.due_time || "23:59:59"}`,
        edited_at: null,
        due_at: null,
        attachments: [],
        assignee_status: assignee.status,
        profiles: people[assignee.va_id] ?? null,
        task: {
          id: task.id,
          task_name: task.task_name,
          task_detail: task.task_detail,
          account: task.account,
          project: task.project,
          project_id: task.project_id,
          project_kind: null,
          project_name: null,
          status: task.status,
          category: task.category,
          review_required: task.review_required,
          assigned_by: task.assigned_by,
          is_output_based: task.fixed_pay_task_id != null,
          assigned_by_name: task.assigned_by_profile?.full_name ?? task.assigned_by_profile?.username ?? null,
          due_date: task.due_date,
          due_time: task.due_time,
          end_date: task.end_date,
          end_time: task.end_time,
        },
      });
    }
  }

  return expected;
}

/** Org-scoped equivalent of loadPotentialTasks — time logged on org tasks
 *  that have no submission on this page yet. */
async function loadPotentialTasks(admin: AdminClient, opts: { since: string; excludeTaskIds: Set<number>; organizationId: string }) {
  const potentialTasks: Array<{ task: Record<string, unknown>; logs: Array<[string, string, number]> }> = [];
  const potentialPeople: Record<string, string> = {};

  const { data: logData } = await fetchAllPages((from, to) =>
    admin
      .from("time_logs")
      .select("assigned_task_id, user_id, start_time, duration_ms")
      .not("assigned_task_id", "is", null)
      .gte("start_time", opts.since)
      .gt("duration_ms", 0)
      .order("id")
      .range(from, to)
  );
  const logs = ((logData ?? []) as Array<{ assigned_task_id: number; user_id: string; start_time: string; duration_ms: number }>).filter(
    (l) => !opts.excludeTaskIds.has(l.assigned_task_id)
  );
  if (logs.length === 0) return { potentialTasks, potentialPeople };

  const taskIds = Array.from(new Set(logs.map((l) => l.assigned_task_id)));
  const tasks = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < taskIds.length; i += 200) {
    const { data } = await admin
      .from("assigned_tasks")
      .select("id, task_name, task_detail, account, project, project_id, category, assigned_by, fixed_pay_task_id, due_date, organization_id")
      .in("id", taskIds.slice(i, i + 200));
    for (const t of data ?? []) if (t.organization_id === opts.organizationId) tasks.set(t.id as number, t);
  }

  const byTask = new Map<number, Array<[string, string, number]>>();
  for (const l of logs) {
    const task = tasks.get(l.assigned_task_id);
    if (!task) continue;
    const list = byTask.get(l.assigned_task_id) ?? [];
    list.push([l.user_id, l.start_time, l.duration_ms]);
    byTask.set(l.assigned_task_id, list);
  }

  const userIds = Array.from(new Set(Array.from(byTask.values()).flatMap((list) => list.map(([u]) => u))));
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin.from("profiles").select("id, full_name, username").in("id", userIds.slice(i, i + 200));
    for (const p of data ?? []) potentialPeople[p.id as string] = (p.full_name as string) || (p.username as string) || "Unknown";
  }

  for (const [taskId, taskLogs] of byTask) {
    const t = tasks.get(taskId)!;
    potentialTasks.push({
      task: {
        id: t.id,
        task_name: t.task_name,
        task_detail: t.task_detail,
        account: t.account,
        project: t.project,
        project_id: t.project_id,
        project_kind: null,
        project_name: null,
        category: t.category,
        assigned_by: t.assigned_by,
        is_output_based: t.fixed_pay_task_id != null,
        due_date: t.due_date,
      },
      logs: taskLogs,
    });
  }
  return { potentialTasks, potentialPeople };
}

async function loadUnreadByTask(admin: AdminClient, feed: Array<Record<string, unknown> & { id: number }>, userId: string) {
  const unreadByTask: Record<number, number> = {};
  const rows = feed as unknown as Array<{ id: number; assigned_task_id: number | null; user_id: string | null; message_type: string; created_at: string }>;
  const candidates = rows.filter((r) => r.assigned_task_id != null && isUnreadCandidate(r, userId));
  if (candidates.length === 0) return unreadByTask;

  const candidateIds = candidates.map((r) => r.id);
  const { data: seen, error } = await fetchAllPages<{ submission_id: number }>((from, to) =>
    admin.from("submission_reads").select("submission_id").eq("user_id", userId).in("submission_id", candidateIds).order("submission_id").range(from, to)
  );
  if (error) return unreadByTask;

  const seenIds = new Set(seen.map((s) => s.submission_id));
  for (const row of candidates) {
    if (seenIds.has(row.id)) continue;
    const taskId = row.assigned_task_id as number;
    unreadByTask[taskId] = (unreadByTask[taskId] ?? 0) + 1;
  }
  return unreadByTask;
}

/**
 * GET /api/client-admin/submissions — the client-facing equivalent of
 * Productivity → Submissions, scoped entirely to the caller's own org
 * (assigned_tasks.organization_id). No admin/VA branching: a valid client
 * caller always sees every task in their org, same as `seesAll` on the real
 * route, and never anything outside it.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { userId, organizationId } = auth;

  const admin = serviceClient();

  const buildQuery = () =>
    admin
      .from("task_submissions")
      .select(
        "id, assigned_task_id, user_id, message_type, content, submission_link, submission_comment, created_at, edited_at, edited_by, due_at, no_fault, progress_status, review_requested, filed_to_project, " +
          "profiles!task_submissions_user_id_profiles_fkey(id, full_name, username), " +
          "assigned_tasks!task_submissions_assigned_task_id_fkey(id, task_name, task_detail, account, project, project_id, status, due_date, due_time, end_date, end_time, created_at, category, review_required, assigned_by, fixed_pay_task_id, organization_id, assigned_by_profile:profiles!assigned_tasks_assigned_by_fkey(id, full_name, username))"
      )
      .not("assigned_task_id", "is", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

  type Row = Record<string, unknown> & {
    id: number;
    created_at: string;
    assigned_tasks?: {
      id: number;
      task_name: string;
      task_detail: string | null;
      account: string | null;
      project: string | null;
      project_id: string | null;
      status: string | null;
      category: string | null;
      review_required: boolean | null;
      assigned_by: string | null;
      fixed_pay_task_id: number | null;
      organization_id: string | null;
      assigned_by_profile?: { id: string; full_name: string | null; username: string | null } | null;
      due_date: string | null;
      due_time: string | null;
      end_date: string | null;
      end_time: string | null;
      created_at: string | null;
    } | null;
  };

  const { data, error } = await fetchAllPages((from, to) => buildQuery().range(from, to));
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Org scoping happens here rather than in the query: PostgREST can't
  // express "the embedded row's column equals X" as a query-level filter.
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.assigned_tasks?.organization_id === organizationId);

  const submissionIds = rows.map((r) => r.id);
  const taskIds = Array.from(new Set(rows.map((r) => r.assigned_tasks?.id).filter((v): v is number => v != null)));
  const completedTasks = new Set(rows.filter((r) => r.assigned_tasks?.status === "completed").map((r) => r.assigned_tasks!.id));

  const oldest = rows.reduce<string | null>((min, r) => (min == null || r.created_at < min ? r.created_at : min), null);
  const potentialPromise = oldest
    ? loadPotentialTasks(admin, {
        since: new Date(new Date(oldest).getTime() - 31 * 86_400_000).toISOString(),
        excludeTaskIds: new Set(taskIds),
        organizationId,
      })
    : Promise.resolve({ potentialTasks: [], potentialPeople: {} as Record<string, string> });

  const [filesBySubmission, screenshotData, roundData, expected, unreadByTask, potential] = await Promise.all([
    loadAttachments(admin, submissionIds, rows),
    loadScreenshots(admin, submissionIds),
    loadRoundData(admin, taskIds, completedTasks),
    loadExpectedWork(admin, organizationId),
    loadUnreadByTask(admin, rows, userId),
    potentialPromise,
  ]);
  const { potentialTasks, potentialPeople } = potential;
  const { taskSubmissions, taskLogs, reviewState, flaggedTasks } = roundData;
  const { reportBySubmission: linkedShots, reportLogs } = screenshotData;

  const taskOfSubmission = new Map(rows.map((r) => [r.id, r.assigned_tasks?.id ?? null] as const));
  const shotsByTask = new Map<number, Array<Record<string, unknown>>>();
  for (const [sid, shots] of linkedShots) {
    const taskId = taskOfSubmission.get(sid);
    if (taskId == null) continue;
    shotsByTask.set(taskId, [...(shotsByTask.get(taskId) ?? []), ...shots]);
  }
  const logStartById: Record<number, string | null> = {};
  for (const [id, l] of Object.entries(reportLogs)) logStartById[Number(id)] = l.start_time;
  const reportBySubmission = new Map<number, Array<Record<string, unknown>>>();
  const screenshotsBySubmission = new Map<number, Array<Record<string, unknown>>>();
  for (const [taskId, shots] of shotsByTask) {
    const placed = placeShotsByWork(
      shots as Array<Record<string, unknown> & { submission_id: number | null; log_id: number | null }>,
      taskSubmissions[taskId] ?? [],
      logStartById
    );
    for (const [sid, list] of placed) {
      reportBySubmission.set(sid, list);
      screenshotsBySubmission.set(sid, list.filter((s) => s.drive_file_id != null).map(shotAttachment));
    }
  }

  const submissions = rows.map((row) => {
    const task = row.assigned_tasks;
    const { assigned_tasks: _omit, ...rest } = row;
    void _omit;
    return {
      ...rest,
      sc_shots: reportBySubmission.get(row.id) ?? [],
      attachments: [...(screenshotsBySubmission.get(row.id) ?? []), ...(filesBySubmission.get(row.id) ?? [])],
      task: task
        ? {
            id: task.id,
            task_name: task.task_name,
            task_detail: task.task_detail,
            account: task.account,
            project: task.project,
            project_id: task.project_id,
            project_kind: null,
            project_name: null,
            status: task.status,
            category: task.category,
            review_required: task.review_required,
            assigned_by: task.assigned_by,
            is_output_based: task.fixed_pay_task_id != null,
            assigned_by_name: task.assigned_by_profile?.full_name ?? task.assigned_by_profile?.username ?? null,
            due_date: task.due_date,
            due_time: task.due_time,
            end_date: task.end_date,
            end_time: task.end_time,
          }
        : null,
    };
  });

  return Response.json({
    submissions,
    expected,
    taskSubmissions,
    taskLogs,
    scLogs: reportLogs,
    potentialTasks,
    potentialPeople,
    reviewState,
    flaggedTasks,
    unreadByTask,
    seesAll: true,
    canReview: true,
    canEmptyTrash: false,
  });
}
