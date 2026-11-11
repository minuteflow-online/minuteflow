import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { splitSubmissionLinks } from "@/lib/submissions";
import { filterAccessibleProjectIds } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Same cap as files-overview — high enough that filtering finds old work. */
const LIMIT = 300;

/**
 * GET /api/projects/submitted-files?projectIds=a,b,c
 * Files that came IN through a task submission for the given objectives/
 * operations — the "Submitted" tab of the Docs card, distinct from
 * files-overview's "Uploaded" (project_files). A submitted item is either an
 * attachment (assigned_task_attachments rows tied to a submission) or a link
 * the VA pasted (task_submissions.submission_link). Both are scoped through the
 * objective's own subtasks (assigned_tasks.project_id), and limited to
 * submissions a reviewer ticked "File to Docs & Files" on when approving
 * (task_submissions.filed_to_project).
 * Returns { files: [{ id, project_id, filename, uploaded_at, href?, account,
 * task_id, task_name, person_id, person_name }] } — person is whoever submitted.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedIds = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (requestedIds.length === 0) return Response.json({ files: [] });

  const supabase = serviceClient();

  // Keep only the ids this caller actually has a reason to see — same rule
  // assigned-tasks applies (see PR #263). Without it, any project id here
  // returned that project's submitted files and links in full.
  const { data: profile } = await authClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const ids = await filterAccessibleProjectIds(supabase, profile, user.id, requestedIds);
  if (ids.length === 0) return Response.json({ files: [] });

  // 1. Subtasks under these objectives → task id → project, name, account.
  const { data: tasks, error: tErr } = await supabase
    .from("assigned_tasks")
    .select("id, project_id, task_name, account")
    .in("project_id", ids)
    .is("deleted_at", null);
  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });
  const taskById = new Map<number, { project_id: string; task_name: string | null; account: string | null }>();
  for (const t of tasks ?? []) {
    taskById.set(t.id as number, {
      project_id: t.project_id as string,
      task_name: (t.task_name as string | null) ?? null,
      account: (t.account as string | null) ?? null,
    });
  }
  const taskIds = Array.from(taskById.keys());
  if (taskIds.length === 0) return Response.json({ files: [] });

  // 2. Submissions on those subtasks → submission id → task id, plus any link.
  // Only the ones a reviewer chose to file here on approval — submissions are
  // no longer collected into Docs & Files automatically.
  const { data: subs, error: sErr } = await supabase
    .from("task_submissions")
    .select("id, assigned_task_id, user_id, submission_link, created_at")
    .in("assigned_task_id", taskIds)
    .eq("filed_to_project", true);
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
  const subById = new Map<number, { task_id: number; user_id: string | null }>();
  for (const s of subs ?? []) {
    subById.set(s.id as number, { task_id: s.assigned_task_id as number, user_id: (s.user_id as string | null) ?? null });
  }

  type Item = {
    id: string;
    project_id: string;
    filename: string;
    uploaded_at: string;
    href?: string;
    account: string | null;
    task_id: number;
    task_name: string | null;
    person_id: string | null;
    person_name: string | null;
    /** Lets the card preview images and PDFs in place. */
    mime_type?: string | null;
    /** Server-side only — signed into href below, then dropped. */
    storage_path?: string;
  };
  const items: Item[] = [];

  // Pasted links count as submitted docs too — a submission can carry more
  // than one (stored one per line in the same field), so each becomes its
  // own entry rather than one entry whose filename is several URLs at once.
  for (const s of subs ?? []) {
    const links = splitSubmissionLinks(s.submission_link as string | null);
    if (links.length === 0) continue;
    const taskId = s.assigned_task_id as number;
    const task = taskById.get(taskId);
    if (!task) continue;
    links.forEach((link, i) => {
      items.push({
        id: `link-${s.id}-${i}`,
        project_id: task.project_id,
        filename: link,
        uploaded_at: s.created_at as string,
        href: link,
        account: task.account,
        task_id: taskId,
        task_name: task.task_name,
        person_id: (s.user_id as string | null) ?? null,
        person_name: null,
      });
    });
  }

  // 3. Attachments tied to those submissions. Screenshots excluded — Assets,
  // Docs & Files is for what the VA actually turned in, not evidence shots
  // (Toni's call, 2026-11-11). A null kind is legacy data from before the
  // screenshot/file split existed, always a deliberate upload back then, so
  // it counts as filable same as "file".
  const subIds = Array.from(subById.keys());
  if (subIds.length > 0) {
    const { data: atts, error: aErr } = await supabase
      .from("assigned_task_attachments")
      .select("id, submission_id, filename, uploaded_at, uploaded_by, storage_path, mime_type, kind")
      .in("submission_id", subIds);
    if (aErr) return Response.json({ error: aErr.message }, { status: 500 });
    for (const a of atts ?? []) {
      if (a.kind === "screenshot") continue;
      const sub = subById.get(a.submission_id as number);
      const task = sub ? taskById.get(sub.task_id) : undefined;
      if (!sub || !task) continue;
      items.push({
        id: `att-${a.id}`,
        project_id: task.project_id,
        filename: (a.filename as string) || "Attachment",
        uploaded_at: a.uploaded_at as string,
        account: task.account,
        task_id: sub.task_id,
        task_name: task.task_name,
        // The submitter, falling back to whoever stored the file.
        person_id: sub.user_id ?? ((a.uploaded_by as string | null) ?? null),
        person_name: null,
        mime_type: (a.mime_type as string | null) ?? null,
        storage_path: (a.storage_path as string | null) ?? undefined,
      });
    }
  }

  items.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  const page = items.slice(0, LIMIT);

  // Submitted attachments used to come back with no link, so clicking one
  // only opened the objective. Sign the ones on this page in one call (same
  // bucket and expiry as files-overview) so they open and preview like uploads.
  const paths = page.map((f) => f.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("task-attachments").createSignedUrls(paths, 3600);
    const hrefByPath = new Map<string, string>();
    for (const s of signed ?? []) if (s.path && s.signedUrl) hrefByPath.set(s.path, s.signedUrl);
    for (const f of page) {
      if (f.storage_path) f.href = hrefByPath.get(f.storage_path);
    }
  }
  for (const f of page) delete f.storage_path;

  // Names for the "who" filter, in one lookup.
  const personIds = Array.from(new Set(page.map((f) => f.person_id).filter((p): p is string => Boolean(p))));
  if (personIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", personIds);
    const nameById = new Map<string, string>();
    for (const p of people ?? []) nameById.set(p.id as string, (p.full_name as string) || (p.username as string) || "");
    for (const f of page) if (f.person_id) f.person_name = nameById.get(f.person_id) || null;
  }

  return Response.json({ files: page });
}
