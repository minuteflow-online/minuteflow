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

// Field names as the form labels them. The log stores column names, which are
// not what anyone reading it is looking at.
const LABELS: Record<string, string> = {
  account: "Account",
  project: "Objective",
  project_id: "Linked objective",
  parent_task_id: "Parent task",
  category: "Category",
  task_name: "Task name",
  task_detail: "Client detail",
  task_notes: "Notes",
  link: "Link",
  due_date: "Due date",
  due_time: "Due time",
  start_date: "Start date",
  end_date: "End date",
  start_time: "Start time",
  end_time: "End time",
  planned_minutes: "Duration",
  assigned_by: "Assigned by",
  instructions: "Instructions",
  instructions_locked: "Instructions lock",
  review_required: "Review required",
  review_required_locked: "Review lock",
  status: "Status",
  archived_at: "Archived",
  deleted_at: "Trash",
};

/**
 * GET /api/assigned-tasks/[id]/edits
 *
 * Who changed this task, and when — recorded only for edits made by someone
 * who is not on the task (see the PUT/PATCH handlers). Anyone who can see the
 * task can see its history: the point is that an assignee finds out their work
 * was changed under them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = serviceClient();

  const { data, error } = await supabase
    .from("assigned_task_edits")
    .select("id, edited_by, edited_at, fields")
    .eq("assigned_task_id", id)
    .order("edited_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{ id: number; edited_by: string; edited_at: string; fields: string[] }>;
  const editorIds = Array.from(new Set(rows.map((r) => r.edited_by)));
  const names = new Map<string, string>();
  if (editorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", editorIds);
    for (const p of profiles ?? []) {
      names.set(p.id as string, ((p.full_name as string) || (p.username as string)) ?? "Unknown");
    }
  }

  return Response.json({
    edits: rows.map((r) => ({
      id: r.id,
      edited_at: r.edited_at,
      editor: names.get(r.edited_by) ?? "Unknown",
      fields: (r.fields ?? []).map((f) => LABELS[f] ?? f),
    })),
  });
}
