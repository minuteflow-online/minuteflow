import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { splitSubmissionLinks } from "@/lib/submissions";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Same cap files-overview/submitted-files use. */
const LIMIT = 300;

type AssetRow = {
  id: string;
  /** Null means Adhoc — a task with no Objective or Operation. */
  project_id: string | null;
  project_kind: "objective" | "operation" | null;
  filename: string;
  uploaded_at: string;
  href?: string | null;
  account: string | null;
  task_id: number | null;
  task_name: string | null;
  person_id: string | null;
  person_name: string | null;
  mime_type?: string | null;
};

/**
 * GET /api/projects/assets-overview
 * The company-wide "Assets, Docs & Files" — every Objective, Operation, and
 * Adhoc task combined, not scoped to one project like files-overview/
 * submitted-files are. Admin-only (Toni's call, 2026-11-11): the per-objective
 * Docs & Files tab VAs already have is untouched by this — this is a separate,
 * new top-level view, and this route is new code, not a rework of those two.
 * Returns { files, submittedFiles, projects } — files/submittedFiles are kept
 * as two arrays, same shape ObjectiveOverview's Docs card already expects, so
 * the page's own filter logic can mirror that component's.
 */
export async function GET() {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = serviceClient();

  const [{ data: projects }, { data: tasks }] = await Promise.all([
    supabase.from("projects").select("id, name, kind"),
    supabase.from("assigned_tasks").select("id, project_id, task_name, account").is("deleted_at", null),
  ]);

  const projectKindById = new Map<string, "objective" | "operation">();
  for (const p of projects ?? []) projectKindById.set(p.id as string, p.kind as "objective" | "operation");

  const taskById = new Map<number, { project_id: string | null; task_name: string | null; account: string | null }>();
  for (const t of tasks ?? []) {
    taskById.set(t.id as number, {
      project_id: (t.project_id as string | null) ?? null,
      task_name: (t.task_name as string | null) ?? null,
      account: (t.account as string | null) ?? null,
    });
  }
  const taskIds = Array.from(taskById.keys());

  const files: AssetRow[] = [];
  const submittedFiles: AssetRow[] = [];

  // ── Uploaded: project-level docs (every project) + files attached straight
  // to a task (not through a submission), any task including Adhoc. ─────────
  const [{ data: projFiles, error: pfErr }, { data: directAtts, error: daErr }] = await Promise.all([
    supabase
      .from("project_files")
      .select("id, project_id, filename, uploaded_at, uploaded_by")
      .order("uploaded_at", { ascending: false })
      .limit(LIMIT),
    taskIds.length > 0
      ? supabase
          .from("assigned_task_attachments")
          .select("id, filename, uploaded_at, storage_path, assigned_task_id, uploaded_by, mime_type")
          .in("assigned_task_id", taskIds)
          .is("submission_id", null)
          .order("uploaded_at", { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (pfErr) return Response.json({ error: pfErr.message }, { status: 500 });
  if (daErr) return Response.json({ error: daErr.message }, { status: 500 });

  for (const f of projFiles ?? []) {
    files.push({
      id: `pf_${f.id}`,
      project_id: f.project_id as string,
      project_kind: projectKindById.get(f.project_id as string) ?? null,
      filename: f.filename as string,
      uploaded_at: f.uploaded_at as string,
      href: null,
      account: null,
      task_id: null,
      task_name: null,
      person_id: (f.uploaded_by as string | null) ?? null,
      person_name: null,
    });
  }

  const directRows = directAtts ?? [];
  const directPaths = directRows.map((a) => a.storage_path as string);
  const { data: directSigned } = directPaths.length
    ? await supabase.storage.from("task-attachments").createSignedUrls(directPaths, 3600)
    : { data: [] };
  const directHrefByPath = new Map<string, string>();
  for (const s of directSigned ?? []) if (s.path && s.signedUrl) directHrefByPath.set(s.path, s.signedUrl);
  for (const a of directRows) {
    const task = taskById.get(a.assigned_task_id as number);
    if (!task) continue;
    files.push({
      id: `att_${a.id}`,
      project_id: task.project_id,
      project_kind: task.project_id ? projectKindById.get(task.project_id) ?? null : null,
      filename: a.filename as string,
      uploaded_at: a.uploaded_at as string,
      href: directHrefByPath.get(a.storage_path as string) ?? null,
      account: task.account,
      task_id: a.assigned_task_id as number,
      task_name: task.task_name,
      person_id: (a.uploaded_by as string | null) ?? null,
      person_name: null,
      mime_type: (a.mime_type as string | null) ?? null,
    });
  }

  // ── Submitted: filed_to_project submissions, any task including Adhoc. ────
  // Attachments are filtered to exclude screenshots — see PR #397.
  const { data: subs, error: sErr } = taskIds.length > 0
    ? await supabase
        .from("task_submissions")
        .select("id, assigned_task_id, user_id, submission_link, created_at")
        .in("assigned_task_id", taskIds)
        .eq("filed_to_project", true)
    : { data: [], error: null };
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });

  const subById = new Map<number, { task_id: number; user_id: string | null }>();
  for (const s of subs ?? []) {
    subById.set(s.id as number, { task_id: s.assigned_task_id as number, user_id: (s.user_id as string | null) ?? null });
  }

  for (const s of subs ?? []) {
    const links = splitSubmissionLinks(s.submission_link as string | null);
    if (links.length === 0) continue;
    const taskId = s.assigned_task_id as number;
    const task = taskById.get(taskId);
    if (!task) continue;
    links.forEach((link, i) => {
      submittedFiles.push({
        id: `link-${s.id}-${i}`,
        project_id: task.project_id,
        project_kind: task.project_id ? projectKindById.get(task.project_id) ?? null : null,
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

  const subIds = Array.from(subById.keys());
  if (subIds.length > 0) {
    const { data: atts, error: aErr } = await supabase
      .from("assigned_task_attachments")
      .select("id, submission_id, filename, uploaded_at, uploaded_by, storage_path, mime_type, kind")
      .in("submission_id", subIds);
    if (aErr) return Response.json({ error: aErr.message }, { status: 500 });
    const rows = (atts ?? []).filter((a) => a.kind !== "screenshot");
    const paths = rows.map((a) => a.storage_path as string);
    const { data: signed } = paths.length
      ? await supabase.storage.from("task-attachments").createSignedUrls(paths, 3600)
      : { data: [] };
    const hrefByPath = new Map<string, string>();
    for (const s of signed ?? []) if (s.path && s.signedUrl) hrefByPath.set(s.path, s.signedUrl);
    for (const a of rows) {
      const sub = subById.get(a.submission_id as number);
      const task = sub ? taskById.get(sub.task_id) : undefined;
      if (!sub || !task) continue;
      submittedFiles.push({
        id: `att-${a.id}`,
        project_id: task.project_id,
        project_kind: task.project_id ? projectKindById.get(task.project_id) ?? null : null,
        filename: (a.filename as string) || "Attachment",
        uploaded_at: a.uploaded_at as string,
        href: hrefByPath.get(a.storage_path as string) ?? undefined,
        account: task.account,
        task_id: sub.task_id,
        task_name: task.task_name,
        person_id: sub.user_id ?? ((a.uploaded_by as string | null) ?? null),
        person_name: null,
        mime_type: (a.mime_type as string | null) ?? null,
      });
    }
  }

  files.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  submittedFiles.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  const filesPage = files.slice(0, LIMIT);
  const submittedPage = submittedFiles.slice(0, LIMIT);

  // Names for the "who" filter, in one lookup.
  const personIds = Array.from(
    new Set([...filesPage, ...submittedPage].map((f) => f.person_id).filter((p): p is string => Boolean(p)))
  );
  if (personIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", personIds);
    const nameById = new Map<string, string>();
    for (const p of people ?? []) nameById.set(p.id as string, (p.full_name as string) || (p.username as string) || "");
    for (const f of filesPage) if (f.person_id) f.person_name = nameById.get(f.person_id) || null;
    for (const f of submittedPage) if (f.person_id) f.person_name = nameById.get(f.person_id) || null;
  }

  return Response.json({
    files: filesPage,
    submittedFiles: submittedPage,
    projects: (projects ?? []).map((p) => ({ id: p.id as string, name: p.name as string, kind: p.kind as "objective" | "operation" })),
  });
}
