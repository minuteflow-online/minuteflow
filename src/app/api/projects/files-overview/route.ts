import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type OverviewFile = { id: string; project_id: string; filename: string; uploaded_at: string; href?: string | null };

/**
 * GET /api/projects/files-overview?projectIds=a,b,c
 * Recent files across the given objectives/operations, newest first, for the
 * Docs card's "Uploaded" tab. Two sources are merged: project-level docs
 * (project_files) and files attached to the tasks under those projects
 * (assigned_task_attachments — i.e. documents added when the task was created).
 * Returns { files: [{ id, project_id, filename, uploaded_at, href }] } — href
 * is a signed download link for task attachments; project docs open in the
 * objective's own Docs cabinet.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ files: [] });

  const supabase = serviceClient();

  // Project-level docs and the tasks in these projects, in parallel.
  const [{ data: projFiles, error }, { data: tasks }] = await Promise.all([
    supabase
      .from("project_files")
      .select("id, project_id, filename, uploaded_at")
      .in("project_id", ids)
      .order("uploaded_at", { ascending: false })
      .limit(50),
    supabase
      .from("assigned_tasks")
      .select("id, project_id")
      .in("project_id", ids),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const files: OverviewFile[] = (projFiles ?? []).map((f) => ({
    id: `pf_${f.id}`,
    project_id: f.project_id as string,
    filename: f.filename as string,
    uploaded_at: f.uploaded_at as string,
    href: null,
  }));

  // Files attached to those tasks (uploaded when the task was created/edited),
  // mapped back to their task's project so they land in the right objective.
  const projectByTask = new Map<number, string>();
  for (const t of tasks ?? []) projectByTask.set(t.id as number, t.project_id as string);
  const taskIds = Array.from(projectByTask.keys());
  if (taskIds.length > 0) {
    const { data: atts } = await supabase
      .from("assigned_task_attachments")
      .select("id, filename, uploaded_at, storage_path, assigned_task_id")
      .in("assigned_task_id", taskIds)
      .order("uploaded_at", { ascending: false })
      .limit(50);
    for (const a of atts ?? []) {
      const projectId = projectByTask.get(a.assigned_task_id as number);
      if (!projectId) continue;
      let href: string | null = null;
      const { data: signed } = await supabase.storage
        .from("task-attachments")
        .createSignedUrl(a.storage_path as string, 3600);
      if (signed?.signedUrl) href = signed.signedUrl;
      files.push({
        id: `att_${a.id}`,
        project_id: projectId,
        filename: a.filename as string,
        uploaded_at: a.uploaded_at as string,
        href,
      });
    }
  }

  files.sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""));
  return Response.json({ files: files.slice(0, 50) });
}
