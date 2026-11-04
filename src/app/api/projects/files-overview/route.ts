import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { filterAccessibleProjectIds } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Enough to filter a whole objective's history by account / task / person on
 * the client. The cap used to be 50, which made filtering meaningless — the
 * file being looked for was often just past it.
 */
const LIMIT = 300;

type OverviewFile = {
  id: string;
  project_id: string;
  filename: string;
  uploaded_at: string;
  href?: string | null;
  account: string | null;
  task_id: number | null;
  task_name: string | null;
  person_id: string | null;
  person_name: string | null;
};

/**
 * GET /api/projects/files-overview?projectIds=a,b,c
 * Recent files across the given objectives/operations, newest first, for the
 * Docs card's "Uploaded" tab. Two sources are merged: project-level docs
 * (project_files) and files attached to the tasks under those projects
 * (assigned_task_attachments — i.e. documents added when the task was created).
 * Attachments that came in with a submission are left to submitted-files, so
 * one file doesn't show up under both tabs.
 * Returns { files: [{ id, project_id, filename, uploaded_at, href, account,
 * task_id, task_name, person_id, person_name }] } — href is a signed download
 * link for task attachments; project docs open in the objective's own Docs
 * cabinet.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedIds = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (requestedIds.length === 0) return Response.json({ files: [] });

  const supabase = serviceClient();

  // Keep only the ids this caller actually has a reason to see (owns the
  // project, or was granted access via project_va_access) — the same rule
  // assigned-tasks applies (see PR #263). Without it, any project id here
  // returned that project's files in full, with working download links.
  const { data: profile } = await authClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const ids = await filterAccessibleProjectIds(supabase, profile, user.id, requestedIds);
  if (ids.length === 0) return Response.json({ files: [] });

  // Project-level docs and the tasks in these projects, in parallel.
  const [{ data: projFiles, error }, { data: tasks }] = await Promise.all([
    supabase
      .from("project_files")
      .select("id, project_id, filename, uploaded_at, uploaded_by")
      .in("project_id", ids)
      .order("uploaded_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("assigned_tasks")
      .select("id, project_id, task_name, account")
      .in("project_id", ids),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const files: OverviewFile[] = (projFiles ?? []).map((f) => ({
    id: `pf_${f.id}`,
    project_id: f.project_id as string,
    filename: f.filename as string,
    uploaded_at: f.uploaded_at as string,
    href: null,
    account: null,
    task_id: null,
    task_name: null,
    person_id: (f.uploaded_by as string | null) ?? null,
    person_name: null,
  }));

  // Files attached to those tasks (uploaded when the task was created/edited),
  // mapped back to their task's project so they land in the right objective.
  const taskById = new Map<number, { project_id: string; task_name: string | null; account: string | null }>();
  for (const t of tasks ?? []) {
    taskById.set(t.id as number, {
      project_id: t.project_id as string,
      task_name: (t.task_name as string | null) ?? null,
      account: (t.account as string | null) ?? null,
    });
  }
  const taskIds = Array.from(taskById.keys());
  if (taskIds.length > 0) {
    const { data: atts } = await supabase
      .from("assigned_task_attachments")
      .select("id, filename, uploaded_at, storage_path, assigned_task_id, uploaded_by")
      .in("assigned_task_id", taskIds)
      .is("submission_id", null)
      .order("uploaded_at", { ascending: false })
      .limit(LIMIT);
    const rows = atts ?? [];
    // One signing call for the lot rather than one round trip per file — at
    // the higher cap the per-file loop would have been hundreds of requests.
    const paths = rows.map((a) => a.storage_path as string);
    const { data: signed } = paths.length
      ? await supabase.storage.from("task-attachments").createSignedUrls(paths, 3600)
      : { data: [] };
    const hrefByPath = new Map<string, string>();
    for (const s of signed ?? []) if (s.path && s.signedUrl) hrefByPath.set(s.path, s.signedUrl);
    for (const a of rows) {
      const task = taskById.get(a.assigned_task_id as number);
      if (!task) continue;
      files.push({
        id: `att_${a.id}`,
        project_id: task.project_id,
        filename: a.filename as string,
        uploaded_at: a.uploaded_at as string,
        href: hrefByPath.get(a.storage_path as string) ?? null,
        account: task.account,
        task_id: a.assigned_task_id as number,
        task_name: task.task_name,
        person_id: (a.uploaded_by as string | null) ?? null,
        person_name: null,
      });
    }
  }

  files.sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  const page = files.slice(0, LIMIT);

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
