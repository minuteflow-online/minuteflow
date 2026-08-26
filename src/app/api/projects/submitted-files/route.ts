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

/**
 * GET /api/projects/submitted-files?projectIds=a,b,c
 * Files that came IN through a task submission for the given objectives/
 * operations — the "Submitted" tab of the Docs card, distinct from
 * files-overview's "Uploaded" (project_files). A submitted item is either an
 * attachment (assigned_task_attachments rows tied to a submission) or a link
 * the VA pasted (task_submissions.submission_link). Both are scoped through the
 * objective's own subtasks (assigned_tasks.project_id).
 * Returns { files: [{ id, project_id, filename, uploaded_at, href? }] }.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ files: [] });

  const supabase = serviceClient();

  // 1. Subtasks under these objectives → task id → project id.
  const { data: tasks, error: tErr } = await supabase
    .from("assigned_tasks")
    .select("id, project_id")
    .in("project_id", ids)
    .is("deleted_at", null);
  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });
  const taskProject = new Map<number, string>();
  for (const t of tasks ?? []) taskProject.set(t.id as number, t.project_id as string);
  const taskIds = Array.from(taskProject.keys());
  if (taskIds.length === 0) return Response.json({ files: [] });

  // 2. Submissions on those subtasks → submission id → task id, plus any link.
  const { data: subs, error: sErr } = await supabase
    .from("task_submissions")
    .select("id, assigned_task_id, submission_link, created_at")
    .in("assigned_task_id", taskIds);
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
  const subTask = new Map<number, number>();
  for (const s of subs ?? []) subTask.set(s.id as number, s.assigned_task_id as number);

  type Item = { id: string; project_id: string; filename: string; uploaded_at: string; href?: string };
  const items: Item[] = [];

  // Pasted links count as submitted docs too.
  for (const s of subs ?? []) {
    const link = (s.submission_link as string | null) ?? null;
    if (!link) continue;
    const pid = taskProject.get(s.assigned_task_id as number);
    if (!pid) continue;
    items.push({ id: `link-${s.id}`, project_id: pid, filename: link, uploaded_at: s.created_at as string, href: link });
  }

  // 3. Attachments tied to those submissions.
  const subIds = Array.from(subTask.keys());
  if (subIds.length > 0) {
    const { data: atts, error: aErr } = await supabase
      .from("assigned_task_attachments")
      .select("id, submission_id, filename, uploaded_at")
      .in("submission_id", subIds);
    if (aErr) return Response.json({ error: aErr.message }, { status: 500 });
    for (const a of atts ?? []) {
      const taskId = subTask.get(a.submission_id as number);
      const pid = taskId != null ? taskProject.get(taskId) : undefined;
      if (!pid) continue;
      items.push({ id: `att-${a.id}`, project_id: pid, filename: (a.filename as string) || "Attachment", uploaded_at: a.uploaded_at as string });
    }
  }

  items.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  return Response.json({ files: items.slice(0, 50) });
}
