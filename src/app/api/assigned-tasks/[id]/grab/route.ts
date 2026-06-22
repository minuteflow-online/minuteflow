import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type TaskRow = {
  id: string;
  account: string | null;
  project: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  due_date: string | null;
  instructions: string | null;
  instructions_locked: boolean;
  created_at: string | null;
  updated_at: string | null;
  assigned_task_assignees: Array<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
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

  if (!profile || (profile.role !== "va" && profile.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Use service-role client to fetch the task — VAs can't read assigned_tasks
  // rows via the user client unless they're already an assignee (RLS), but
  // the whole point of grab is to claim an unassigned task they're NOT on yet.
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: task, error: fetchError } = await adminSupabase
    .from("assigned_tasks")
    .select(
      "id, account, project, task_name, task_detail, task_notes, due_date, instructions, instructions_locked, created_at, updated_at, assigned_task_assignees(id)"
    )
    .eq("id", id)
    .single();

  if (fetchError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const typedTask = task as TaskRow;
  if ((typedTask.assigned_task_assignees ?? []).length > 0) {
    return Response.json({ error: "Task already claimed" }, { status: 409 });
  }

  const { data: assignee, error: insertError } = await adminSupabase
    .from("assigned_task_assignees")
    .insert({
      assigned_task_id: typedTask.id,
      va_id: user.id,
      status: "on_queue",
    })
    .select("id, va_id, status, log_id, notes, assigned_at, updated_at")
    .single();

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  return Response.json({
    task: {
      ...typedTask,
      assigned_task_assignees: assignee ? [assignee] : [],
    },
  });
}
