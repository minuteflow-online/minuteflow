import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { canEmptySubmissionTrash, canReviewSubmissions } from "@/lib/submissions";
import { isUnreadCandidate } from "@/lib/submissionUnread";
import { placeShotsByWork } from "@/lib/submissionTime";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type AdminClient = SupabaseClient;

/**
 * Every row of a query, however many there are. PostgREST silently truncates
 * any response at 1000 rows — even with an explicit .limit(n) above that — so a
 * query that returns "everything" quietly drops the rest once a table grows
 * past it. Pass a function that builds the query fresh and applies the given
 * range; it must have a stable order, or rows can repeat or go missing between
 * pages.
 */
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

function isAdminProfile(
  profile: { role?: string | null; admin_permissions?: string[] | null } | null | undefined
): boolean {
  return (
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    hasAdminPermission(profile, "task_management")
  );
}

/** storage path -> signed URL, kept for the life of the server instance. */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** Every attachment on this batch of submissions, with a signed URL apiece. */
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
  // Split by submission and run side by side: one big paged request reads its
  // pages one after another, which was the slowest part of this load.
  const idChunks: number[][] = [];
  for (let i = 0; i < submissionIds.length; i += 100) idChunks.push(submissionIds.slice(i, i + 100));
  const linkedPromise = Promise.all(
    idChunks.map((ids) =>
      fetchAll((from, to) =>
        admin
          .from("assigned_task_attachments")
          .select(select)
          .in("submission_id", ids)
          .order("id")
          .range(from, to)
      )
    )
  ).then((parts) => parts.flat());

  // Files a VA drops onto the task in the task editor are saved against the
  // task with no submission_id, so they never showed up here and the reviewer
  // had to open the editor to see the work. Show them on that VA's newest
  // submission for the task — the one they were submitting when they added them.
  const latestByTaskUser = new Map<string, { id: number; created_at: string }>();
  for (const r of rows) {
    const taskId = r.assigned_tasks?.id;
    if (r.message_type !== "submission" || taskId == null) continue;
    const key = `${taskId}:${r.user_id}`;
    const createdAt = String(r.created_at);
    const current = latestByTaskUser.get(key);
    if (!current || createdAt > current.created_at) {
      latestByTaskUser.set(key, { id: r.id, created_at: createdAt });
    }
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

  // One batched call instead of one createSignedUrl round-trip per file —
  // with hundreds of attachments the per-file version was the actual
  // bottleneck behind "submissions takes a while to load", not the SQL.
  // Chunked: a single call with every path (past ~1000) fails outright and
  // leaves every thumbnail without a URL.
  // Links stay valid for an hour, so reuse the ones already signed instead of
  // signing every file again on each page load.
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
    // Cached for 50 of the 60 minutes, so a served link never expires mid-view.
    signedUrlCache.set(s.path, { url: s.signedUrl, expiresAt: now + 50 * 60 * 1000 });
  }

  for (const file of files ?? []) {
    const list = filesBySubmission.get(file.submission_id as number) ?? [];
    list.push({ ...file, url: urlByPath.get(file.storage_path as string) ?? null });
    filesBySubmission.set(file.submission_id as number, list);
  }
  return filesBySubmission;
}

/**
 * Screenshots auto-linked to a submission (Phase 3, Toni's call,
 * 2026-11-02) — shaped as TaskSubmissionAttachment so they can ride in the
 * same `attachments` array the gallery already renders, right alongside
 * whatever was attached by hand. No signed URL needed: screenshots live in
 * Google Drive, not Supabase Storage, and /api/drive-image already serves
 * them directly from drive_file_id (same route ActivityLog's thumbnails use).
 */
async function loadScreenshots(admin: AdminClient, submissionIds: number[]) {
  /**
   * Every capture linked to a submission — markers ("Computer idle", "no
   * browser view") included — for the SC Data pill, which runs Admin's
   * Screenshot Report rules over them in the browser (@/lib/screenshotReport).
   */
  const reportBySubmission = new Map<number, Array<Record<string, unknown>>>();
  /** The time logs those captures ran under, for the report's capture gaps. */
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
            .select(
              "id, submission_id, log_id, filename, drive_file_id, screenshot_type, failure_reason, created_at, captured_at, image_hash"
            )
            .in("submission_id", ids)
            .order("id")
            .range(from, to)
        )
      )
    )
  ).flatMap((r) => r.data ?? []) as Array<Record<string, unknown>>;

  // Keyed by the submission each capture is linked to for now; the GET handler
  // re-places them by the work they were taken during (placeShotsByWork) once
  // every task's submissions are known.
  for (const s of allRows) {
    const sid = s.submission_id as number;
    const list = reportBySubmission.get(sid) ?? [];
    list.push(s);
    reportBySubmission.set(sid, list);
  }

  const logIds = Array.from(
    new Set(allRows.map((s) => s.log_id as number | null).filter((v): v is number => v != null))
  );
  for (let i = 0; i < logIds.length; i += 200) {
    const { data } = await admin
      .from("time_logs")
      .select("id, start_time, end_time, category")
      .in("id", logIds.slice(i, i + 200));
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

/**
 * A capture as a gallery attachment. Only real images ride in the gallery;
 * markers have nothing to show.
 */
function shotAttachment(s: Record<string, unknown>) {
  return {
    // Negative, so it can never collide with a real assigned_task_attachments
    // id when both ride in the same array (that table's ids only ever go up).
    // The page maps it back to the capture (-id) to place it by day.
    id: -(s.id as number),
    filename: (s.filename as string) || "screenshot.png",
    storage_path: "",
    file_size: null,
    mime_type: "image/png",
    url: `/api/drive-image?id=${s.drive_file_id}`,
    // Screen captures, never something the VA turned in: the gallery groups
    // them under Screenshots, and they never count toward File to Assets.
    kind: "screenshot",
  };
}

/**
 * Time tracked on tasks that have no submission on this page yet — the part of
 * a day's Potential the feed itself can't see (Toni's call, 2026-11-11). Only
 * assigned-task time: breaks, sorting and other non-task time stay out. Same
 * visibility as the feed: a non-admin sees their own time and time on tasks
 * they assigned or are on.
 */
async function loadPotentialTasks(
  admin: AdminClient,
  opts: {
    since: string;
    excludeTaskIds: Set<number>;
    isAdminEquivalent: boolean;
    userId: string;
    myTaskIds: Set<number>;
    va: string | null;
    scope: string | null;
    projectId: string | null;
  }
) {
  const potentialTasks: Array<{
    task: Record<string, unknown>;
    logs: Array<[string, string, number]>;
  }> = [];
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
  let logs = ((logData ?? []) as Array<{
    assigned_task_id: number;
    user_id: string;
    start_time: string;
    duration_ms: number;
  }>).filter((l) => !opts.excludeTaskIds.has(l.assigned_task_id));
  if (opts.isAdminEquivalent && opts.va && opts.va !== "all") logs = logs.filter((l) => l.user_id === opts.va);
  if (logs.length === 0) return { potentialTasks, potentialPeople };

  const taskIds = Array.from(new Set(logs.map((l) => l.assigned_task_id)));
  const tasks = new Map<number, Record<string, unknown> & { projects?: { kind: string; name: string } | null }>();
  for (let i = 0; i < taskIds.length; i += 200) {
    const { data } = await admin
      .from("assigned_tasks")
      .select(
        "id, task_name, task_detail, account, project, project_id, category, assigned_by, fixed_pay_task_id, due_date, projects(name, kind)"
      )
      .in("id", taskIds.slice(i, i + 200));
    for (const t of (data ?? []) as unknown as Array<Record<string, unknown> & { projects?: { kind: string; name: string } | null }>) {
      tasks.set(t.id as number, t);
    }
  }

  const byTask = new Map<number, Array<[string, string, number]>>();
  for (const l of logs) {
    const task = tasks.get(l.assigned_task_id);
    if (!task) continue;
    if (
      !opts.isAdminEquivalent &&
      l.user_id !== opts.userId &&
      task.assigned_by !== opts.userId &&
      !opts.myTaskIds.has(l.assigned_task_id)
    )
      continue;
    if (opts.projectId && opts.projectId !== "all") {
      if (task.project_id !== opts.projectId) continue;
    } else if (opts.scope === "adhoc") {
      if (task.project_id) continue;
    } else if (opts.scope === "objective" || opts.scope === "operation") {
      if (task.projects?.kind !== opts.scope) continue;
    }
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
        project_kind: t.projects?.kind ?? null,
        project_name: t.projects?.name ?? null,
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

/**
 * Where each task currently stands, plus the raw material for its time: every
 * (non-trashed) submission on the task and every log worked under it.
 *
 * The split itself — which submission's round a log belongs to, and which day
 * it counts toward — happens in the browser via @/lib/submissionTime, because
 * it depends on the org timezone, and because the full submission list matters:
 * a page filtered down to some submissions must still split time against all
 * of them.
 */
async function loadRoundData(admin: AdminClient, taskIds: number[], completedTasks: Set<number>) {
  /** taskId -> its submissions (id, created_at), oldest first. */
  const taskSubmissions: Record<number, Array<{ id: number; created_at: string }>> = {};
  /** taskId -> every log worked under it, as [start_time, duration_ms]. */
  const taskLogs: Record<number, Array<[string | null, number | null]>> = {};
  /** taskId -> "awaiting" | "revision_requested" | "approved" | "completed" */
  const reviewState: Record<number, string> = {};
  /** taskId -> true while a reviewer's flag is the newest thing on the thread. */
  const flaggedTasks: Record<number, boolean> = {};
  if (taskIds.length === 0) return { taskSubmissions, taskLogs, reviewState, flaggedTasks };

  const [revisionRes, logRes] = await Promise.all([
    // Every thread entry, not just revisions: the newest one also tells us
    // whether the task is still awaiting review (see reviewState below).
    fetchAllPages((from, to) =>
      admin
        .from("task_submissions")
        .select("id, assigned_task_id, message_type, created_at")
        .in("assigned_task_id", taskIds)
        // A trashed entry must not decide where the task stands — cancelling
        // a mistaken reversal works by trashing it, so counting it here would
        // leave the task stuck in the state the mistake caused.
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
    ),

    // Logs now name the task they were worked under, so this asks for
    // exactly the ones that belong to these tasks. It replaces matching on
    // person + task name + account, which counted one session against every
    // recurring instance sharing a name — an eight-hour total for someone
    // on a four-hour day.
    fetchAllPages((from, to) =>
      admin
        .from("time_logs")
        .select("assigned_task_id, start_time, duration_ms")
        .in("assigned_task_id", taskIds)
        .order("id")
        .range(from, to)
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
  for (const list of Object.values(taskSubmissions)) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // The newest submission/revision/approval decides where a task stands.
  // Derived from the thread rather than assigned_tasks.status, which isn't
  // synced when an admin issues a revision and so can't be trusted here.
  const latestByTask = new Map<number, { message_type: string; created_at: string }>();
  for (const entry of allEntries) {
    if (
      ![
        "submission",
        "revision",
        "approval",
        "approval_reversed",
        "revision_reversed",
        "rejection",
        "rejection_reversed",
      ].includes(entry.message_type)
    )
      continue;
    const current = latestByTask.get(entry.assigned_task_id);
    if (!current || entry.created_at > current.created_at) {
      latestByTask.set(entry.assigned_task_id, entry);
    }
  }

  // A flag holds only until something else happens on the thread: clearing it,
  // a new submission, or a review decision all supersede it. Kept out of
  // latestByTask on purpose — a flag is not a decision, so it must never move
  // reviewState.
  const latestFlagMark = new Map<number, { message_type: string; created_at: string }>();
  for (const entry of allEntries) {
    if (
      ![
        "flag",
        "flag_cleared",
        "submission",
        "revision",
        "approval",
        "approval_reversed",
        "revision_reversed",
        "rejection",
        "rejection_reversed",
      ].includes(entry.message_type)
    )
      continue;
    const current = latestFlagMark.get(entry.assigned_task_id);
    if (!current || entry.created_at > current.created_at) {
      latestFlagMark.set(entry.assigned_task_id, entry);
    }
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
            : // submission, or a reversed approval/revision/rejection —
              // either way it's back in front of a reviewer, nothing about
              // the work changed.
              "awaiting";
  }

  // Each log names its task outright, so nothing has to be inferred.
  const logs = (logRes.data ?? []) as Array<{
    assigned_task_id: number | null;
    start_time: string | null;
    duration_ms: number | null;
  }>;

  for (const log of logs) {
    if (log.assigned_task_id == null || !log.start_time) continue;
    (taskLogs[log.assigned_task_id] ??= []).push([log.start_time, log.duration_ms]);
  }

  return { taskSubmissions, taskLogs, reviewState, flaggedTasks };
}

/**
 * Work that is owed, on the day it is owed. The calendar could only ever show
 * what came in, so a person with a full week of due dates and nothing
 * submitted yet had an empty calendar. Tasks still outstanding are returned
 * alongside the submissions and plotted on their due date, which is the
 * question the calendar is actually asked: what am I waiting for, and what is
 * already late.
 *
 * Independent of the submissions query entirely — it reads assigned_tasks
 * directly rather than anything derived from `rows` — so it runs in the same
 * Promise.all wave rather than after it.
 */
async function loadExpectedWork(
  admin: AdminClient,
  opts: {
    isAdminEquivalent: boolean;
    va: string | null;
    scope: string | null;
    projectId: string | null;
    userId: string;
  }
): Promise<Array<Record<string, unknown>>> {
  const { isAdminEquivalent, va, scope, projectId, userId } = opts;
  const expected: Array<Record<string, unknown>> = [];

  // Statuses that mean the work is still owed. Anything submitted or
  // finished is already represented by its submission entry.
  const OPEN_STATUSES = new Set([
    "unassigned",
    "pending",
    "on_queue",
    "in_progress",
    "revision_needed",
  ]);

  const { data: dueTasks } = await fetchAllPages((from, to) =>
    admin
      .from("assigned_tasks")
      .select(
        "id, task_name, task_detail, account, project, project_id, status, due_date, due_time, end_date, end_time, category, review_required, assigned_by, fixed_pay_task_id, " +
          "assigned_by_profile:profiles!assigned_tasks_assigned_by_fkey(id, full_name, username), " +
          "projects(id, name, kind), assigned_task_assignees(id, va_id, status)"
      )
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
    projects?: { id: string; name: string; kind: string } | null;
    assigned_task_assignees?: Array<{ id: number; va_id: string | null; status: string | null }>;
  };

  let dueRows = ((dueTasks ?? []) as unknown as DueTask[]).filter((t) =>
    (t.assigned_task_assignees ?? []).some((a) => OPEN_STATUSES.has(a.status ?? ""))
  );

  // Same visibility rule as the submissions above: your own work, plus
  // anything you assigned and are therefore waiting on.
  if (!isAdminEquivalent) {
    dueRows = dueRows.filter(
      (t) =>
        t.assigned_by === userId ||
        (t.assigned_task_assignees ?? []).some((a) => a.va_id === userId)
    );
  }

  if (isAdminEquivalent && va && va !== "all") {
    dueRows = dueRows.filter((t) => (t.assigned_task_assignees ?? []).some((a) => a.va_id === va));
  }

  if (projectId && projectId !== "all") {
    dueRows = dueRows.filter((t) => t.project_id === projectId);
  } else if (scope === "adhoc") {
    dueRows = dueRows.filter((t) => !t.project_id);
  } else if (scope === "objective" || scope === "operation") {
    dueRows = dueRows.filter((t) => t.projects?.kind === scope);
  }

  // Names for the people the work is owed by. One lookup rather than an
  // embed, because assigned_tasks already embeds profiles once for
  // assigned_by and a second path off the same row is ambiguous.
  const waitingOnIds = [
    ...new Set(
      dueRows
        .flatMap((t) => (t.assigned_task_assignees ?? []).map((a) => a.va_id))
        .filter((v): v is string => Boolean(v))
    ),
  ];
  let people: Record<string, { id: string; full_name: string | null; username: string | null }> = {};
  if (waitingOnIds.length > 0) {
    const { data: peopleRows } = await admin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", waitingOnIds);
    people = Object.fromEntries((peopleRows ?? []).map((p) => [p.id, p]));
  }

  for (const task of dueRows) {
    for (const assignee of task.assigned_task_assignees ?? []) {
      if (!OPEN_STATUSES.has(assignee.status ?? "")) continue;
      if (!assignee.va_id) continue;
      expected.push({
        // Negative so it can never collide with a submission id — the feed
        // keys React nodes and the revision map off this.
        id: -assignee.id,
        assigned_task_id: task.id,
        user_id: assignee.va_id,
        message_type: "expected",
        content: "",
        submission_link: null,
        submission_comment: null,
        // The due moment, so anything that sorts the feed by time puts this
        // where the work is owed. The calendar buckets on due_date itself.
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
          project_kind: task.projects?.kind ?? null,
          project_name: task.projects?.name ?? null,
          status: task.status,
          category: task.category,
          review_required: task.review_required,
          assigned_by: task.assigned_by,
          is_output_based: task.fixed_pay_task_id != null,
          assigned_by_name:
            task.assigned_by_profile?.full_name ?? task.assigned_by_profile?.username ?? null,
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

/**
 * Entries this viewer hasn't opened yet, counted per task. Drives the mail
 * icon on each card and the Unread filter.
 *
 * Tracked in submission_reads rather than the notification rows in `messages`:
 * those are marked read by the bell and the dashboard toast, so a new
 * submission could lose its marker before the reviewer ever scrolled to it.
 */
async function loadUnreadByTask(
  admin: AdminClient,
  feed: Array<Record<string, unknown> & { id: number }>,
  userId: string
) {
  const unreadByTask: Record<number, number> = {};
  const rows = feed as unknown as Array<{
    id: number;
    assigned_task_id: number | null;
    user_id: string | null;
    message_type: string;
    created_at: string;
  }>;
  const candidates = rows.filter((r) => r.assigned_task_id != null && isUnreadCandidate(r, userId));
  if (candidates.length === 0) return unreadByTask;

  const candidateIds = candidates.map((r) => r.id);
  const { data: seen, error } = await fetchAllPages<{ submission_id: number }>((from, to) =>
    admin
      .from("submission_reads")
      .select("submission_id")
      .eq("user_id", userId)
      .in("submission_id", candidateIds)
      .order("submission_id")
      .range(from, to)
  );
  // Without the table there's no way to tell read from unread; showing nothing
  // beats marking every submission as new.
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

  const { searchParams } = new URL(request.url);
  const va = searchParams.get("va");
  const scope = searchParams.get("scope");
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const showTrash = searchParams.get("trash") === "1";

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const buildQuery = () => {
    let query = admin
      .from("task_submissions")
      .select(
        "id, assigned_task_id, user_id, message_type, content, submission_link, submission_comment, created_at, edited_at, edited_by, due_at, progress_status, review_requested, filed_to_project, " +
          "profiles!task_submissions_user_id_profiles_fkey(id, full_name, username), " +
          "assigned_tasks!task_submissions_assigned_task_id_fkey(id, task_name, task_detail, account, project, project_id, status, due_date, due_time, end_date, end_time, created_at, category, review_required, assigned_by, fixed_pay_task_id, assigned_by_profile:profiles!assigned_tasks_assigned_by_fkey(id, full_name, username), projects(id, name, kind))"
      )
      // The whole thread, not just submissions: revision notes, approvals and
      // added notes all belong in the timeline alongside the work.
      .not("assigned_task_id", "is", null)
      // id breaks ties, so paging past 1000 rows can't repeat or skip entries
      // that share a timestamp.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // Trashed submissions are hidden by default and shown on request, so a
    // reviewer can find and restore something binned by mistake.
    query = showTrash
      ? query.not("deleted_at", "is", null)
      : query.is("deleted_at", null);

    if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
    return query;
  };

  // The query above never touches `profile` (the `va` filter that used to
  // depend on it now happens in JS below), so it doesn't have to wait on the
  // profile round-trip — the two fire together instead of stacking. Same for
  // `isAdminEquivalent`-only round trips further down (attachments, round
  // durations, unread count, expected work): none of those depend on each
  // other, so they're batched into one Promise.all after `rows` is known
  // instead of running one after another. On a workspace with a few hundred
  // submissions this was the actual source of "submissions takes a while to
  // load" — not any single slow query, but ~8 of them run in series.
  const profilePromise = Promise.resolve(
    supabase.from("profiles").select("role, department, admin_permissions").eq("id", user.id).single()
  );
  // Expected work only needs the profile, not the submissions below, so it
  // starts as soon as the profile is back and runs alongside the main query.
  const expectedPromise: Promise<Array<Record<string, unknown>>> = showTrash
    ? Promise.resolve([])
    : profilePromise.then(({ data: p }) =>
        loadExpectedWork(admin, {
          isAdminEquivalent: isAdminProfile(p),
          va,
          scope,
          projectId,
          userId: user.id,
        })
      );
  // If the main query fails below we return early; don't leave this unhandled.
  expectedPromise.catch(() => {});
  // Same idea, for the non-admin visibility filter below: which tasks the
  // viewer is actually an assignee of. Only needed for a non-admin, so this
  // is wasted work for an admin viewer, but it's one small indexed query
  // against a boolean the profile fetch already has to resolve first either
  // way — not worth a second serial round-trip to skip it.
  const myTaskIdsPromise: Promise<Set<number>> = profilePromise.then(({ data: p }) =>
    isAdminProfile(p)
      ? Promise.resolve(new Set<number>())
      : admin
          .from("assigned_task_assignees")
          .select("assigned_task_id")
          .eq("va_id", user.id)
          .then(({ data: assigneeRows }) => new Set((assigneeRows ?? []).map((r) => r.assigned_task_id as number)))
  );
  myTaskIdsPromise.catch(() => {});
  const [{ data: profile }, { data, error }, myTaskIds] = await Promise.all([
    profilePromise,
    fetchAllPages((rangeFrom, rangeTo) => buildQuery().range(rangeFrom, rangeTo)),
    myTaskIdsPromise,
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const isAdminEquivalent = isAdminProfile(profile);

  type Row = Record<string, unknown> & {
    id: number;
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
      assigned_by_profile?: { id: string; full_name: string | null; username: string | null } | null;
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

  // Everyone can open this page. Someone without admin access sees their own
  // submissions, anything submitted on a task they assigned (assigned_by is
  // the person who reviews it, so they need to see what's waiting on them),
  // and — the one that was missing — the rest of the thread on a task they're
  // the assignee of. A flag, a revision request, an approval, a plain comment:
  // all of those are written by the REVIEWER, so `user_id` is never the VA's
  // own id, and an output-based task usually has no `assigned_by` at all. Without
  // myTaskIds here, a VA saw their own submission land but never saw the
  // reviewer's response to it — confirmed live on 2026-10-08, where Rexinne
  // Manguiat's own "Alligator Chase – Outside Shot" thread silently dropped
  // both Toni's flag and her revision request.
  // Filtered here rather than in the query because it's an OR across an
  // embedded table, which PostgREST can't express.
  if (!isAdminEquivalent) {
    rows = rows.filter(
      (r) =>
        r.user_id === user.id ||
        r.assigned_tasks?.assigned_by === user.id ||
        (r.assigned_tasks && myTaskIds.has(r.assigned_tasks.id))
    );
  } else if (va && va !== "all") {
    // Previously a query-side .eq(), which needed `profile` before the query
    // could even be built. Applied here instead so the query and the profile
    // lookup above can run concurrently — see the Promise.all note.
    rows = rows.filter((r) => r.user_id === va);
  }

  if (projectId && projectId !== "all") {
    rows = rows.filter((r) => r.assigned_tasks?.project_id === projectId);
  } else if (scope === "adhoc") {
    rows = rows.filter((r) => !r.assigned_tasks?.project_id);
  } else if (scope === "objective" || scope === "operation") {
    rows = rows.filter((r) => r.assigned_tasks?.projects?.kind === scope);
  }

  const submissionIds = rows.map((r) => r.id);
  const taskIds = Array.from(
    new Set(rows.map((r) => r.assigned_tasks?.id).filter((v): v is number => v != null))
  );
  // A task marked complete is done regardless of where its thread ended —
  // otherwise it keeps showing Approve/Revise after someone closed it out.
  const completedTasks = new Set(
    rows.filter((r) => r.assigned_tasks?.status === "completed").map((r) => r.assigned_tasks!.id)
  );

  // Four lookups that only ever read `rows`/`taskIds`, never each other —
  // batched into one wave instead of stacked one after another. That
  // stacking, not any single slow query, was the real source of "submissions
  // takes a while to load": roughly half a dozen sequential Supabase
  // round-trips add up fast even when each one individually is fine.
  // Potential time on tasks with nothing on this page yet. Bounded to a month
  // before the oldest submission shown — no day earlier than that has a card
  // to show it on.
  const oldest = rows.reduce<string | null>(
    (min, r) => (min == null || (r.created_at as string) < min ? (r.created_at as string) : min),
    null
  );
  const potentialPromise =
    oldest && !showTrash
      ? loadPotentialTasks(admin, {
          since: new Date(new Date(oldest).getTime() - 31 * 86_400_000).toISOString(),
          excludeTaskIds: new Set(taskIds),
          isAdminEquivalent,
          userId: user.id,
          myTaskIds,
          va,
          scope,
          projectId,
        })
      : Promise.resolve({ potentialTasks: [], potentialPeople: {} as Record<string, string> });

  const [filesBySubmission, screenshotData, roundData, expected, unreadByTask, potential] = await Promise.all([
    loadAttachments(admin, submissionIds, rows),
    loadScreenshots(admin, submissionIds),
    loadRoundData(admin, taskIds, completedTasks),
    expectedPromise,
    loadUnreadByTask(admin, rows, user.id),
    potentialPromise,
  ]);
  const { potentialTasks, potentialPeople } = potential;
  const { taskSubmissions, taskLogs, reviewState, flaggedTasks } = roundData;
  const { reportBySubmission: linkedShots, reportLogs } = screenshotData;

  // Screenshots follow the work, not the submission that happened to pick them
  // up (Toni's call, 2026-11-11): each capture goes to the round that owns the
  // time log it was taken during — the same rule the time follows. Done per
  // task, against all of that task's submissions.
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
      screenshotsBySubmission.set(
        sid,
        list.filter((s) => s.drive_file_id != null).map(shotAttachment)
      );
    }
  }

  const submissions = rows.map((row) => {
    const task = row.assigned_tasks;
    const { assigned_tasks: _omit, ...rest } = row;
    void _omit;
    return {
      ...rest,
      // Every capture linked to this submission, markers included — what the
      // SC Data pill runs the Screenshot Report over.
      sc_shots: reportBySubmission.get(row.id) ?? [],
      // Screenshots first — they're what was actually happening while the
      // task ran, so they lead the gallery; anything hand-attached follows.
      attachments: [...(screenshotsBySubmission.get(row.id) ?? []), ...(filesBySubmission.get(row.id) ?? [])],
      task: task
        ? {
            id: task.id,
            task_name: task.task_name,
            task_detail: task.task_detail,
            account: task.account,
            project: task.project,
            project_id: task.project_id,
            project_kind: task.projects?.kind ?? null,
            project_name: task.projects?.name ?? null,
            status: task.status,
            category: task.category,
            review_required: task.review_required,
            assigned_by: task.assigned_by,
            // Distinguishes an output-based task (mirrored from fixed_pay_tasks)
            // from a regular time-based one, for the Submissions work-type filter.
            is_output_based: task.fixed_pay_task_id != null,
            assigned_by_name:
              task.assigned_by_profile?.full_name ?? task.assigned_by_profile?.username ?? null,
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
    expected,
    taskSubmissions,
    taskLogs,
    scLogs: reportLogs,
    potentialTasks,
    potentialPeople,
    reviewState,
    flaggedTasks,
    unreadByTask,
    seesAll: isAdminEquivalent,
    canReview: canReviewSubmissions(profile),
    canEmptyTrash: canEmptySubmissionTrash(profile),
  });
}

/**
 * DELETE /api/submissions — empty the submission trash, permanently.
 *
 * The one irreversible action here. Removes every trashed submission along
 * with its uploaded files, so the storage bucket doesn't keep orphans after
 * the rows are gone. Founder only.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canEmptySubmissionTrash(profile)) {
    return Response.json({ error: "Only the Founder can empty the trash" }, { status: 403 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: trashed } = await admin
    .from("task_submissions")
    .select("id")
    .not("deleted_at", "is", null);

  const ids = (trashed ?? []).map((r) => r.id as number);
  if (ids.length === 0) return Response.json({ purged: 0 });

  // Files first: if the rows went first, the storage objects would be
  // unreachable and would sit in the bucket forever.
  const { data: files } = await admin
    .from("assigned_task_attachments")
    .select("id, storage_path")
    .in("submission_id", ids);

  const paths = (files ?? []).map((f) => f.storage_path as string).filter(Boolean);
  if (paths.length > 0) {
    await admin.storage.from("task-attachments").remove(paths);
    await admin.from("assigned_task_attachments").delete().in("submission_id", ids);
  }

  const { error } = await admin.from("task_submissions").delete().in("id", ids);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ purged: ids.length });
}
