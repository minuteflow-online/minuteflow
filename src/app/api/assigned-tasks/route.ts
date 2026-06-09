import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AssignedTaskStatus =
  | "pending"
  | "on_queue"
  | "in_progress"
  | "completed"
  | "cancelled";

type AssigneeRow = {
  id: string;
  va_id: string;
  status: AssignedTaskStatus;
  log_id: number | null;
  notes: string | null;
  assigned_at: string | null;
  updated_at: string | null;
  // Supabase returns the joined relation as an array even for a single row
  profiles: { id: string; full_name: string; username: string }[] | null;
};

type TaskRow = {
  id: string;
  account: string | null;
  project: string | null;
  task_name: string;
  task_detail: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  assignees: AssigneeRow[];
};

/**
 * GET /api/assigned-tasks
 *
 * Admin/manager: all assigned_tasks with their assignees (each assignee
 *   includes profile: { id, full_name, username }).
 *   ?vaId=<uuid>     → filter to tasks assigned to that VA (admin only)
 *   ?status=<status> → filter assignees by status
 *
 * VA: only assigned_task_assignees rows where va_id = auth.uid(),
 *   joined with the parent assigned_tasks row.
 *   ?status=<status> → filter by own assignee status
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const vaIdParam = searchParams.get("vaId");
  const statusParam = searchParams.get("status") as AssignedTaskStatus | null;

  const isAdminOrManager =
    profile?.role === "admin" || profile?.role === "manager";

  if (isAdminOrManager) {
    const assigneeSelect =
      "id, va_id, status, log_id, notes, assigned_at, updated_at, profiles:va_id(id, full_name, username)";

    const query = supabase
      .from("assigned_tasks")
      .select(
        `id, account, project, task_name, task_detail, due_date, created_by, created_at, updated_at,
         assignees:assigned_task_assignees(${assigneeSelect})`
      )
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let result = (data ?? []) as unknown as TaskRow[];

    // Post-filter: if vaId param, keep only tasks that have that VA as assignee
    if (vaIdParam) {
      result = result
        .map((task) => ({
          ...task,
          assignees: (task.assignees as AssigneeRow[]).filter(
            (a) => a.va_id === vaIdParam
          ),
        }))
        .filter((task) => (task.assignees as AssigneeRow[]).length > 0);
    }

    // Post-filter: if status param, filter assignees by status
    if (statusParam) {
      result = result
        .map((task) => ({
          ...task,
          assignees: (task.assignees as AssigneeRow[]).filter(
            (a) => a.status === statusParam
          ),
        }))
        .filter((task) => (task.assignees as AssigneeRow[]).length > 0);
    }

    return Response.json({ tasks: result });
  }

  // VA: return only rows from assigned_task_assignees for this user,
  // joined with the parent task data
  let assigneeQuery = supabase
    .from("assigned_task_assignees")
    .select(
      `id, va_id, status, log_id, notes, assigned_at, updated_at,
       assigned_tasks(id, account, project, task_name, task_detail, due_date, created_by, created_at, updated_at)`
    )
    .eq("va_id", user.id)
    .order("assigned_at", { ascending: false });

  if (statusParam) {
    assigneeQuery = assigneeQuery.eq("status", statusParam);
  }

  const { data: assigneeData, error: assigneeError } = await assigneeQuery;
  if (assigneeError)
    return Response.json({ error: assigneeError.message }, { status: 500 });

  return Response.json({ tasks: assigneeData ?? [] });
}

/**
 * POST /api/assigned-tasks
 * Admin/manager only.
 * Body: { account, project, task_name, task_detail, due_date, va_ids: string[] }
 */
export async function POST(request: Request) {
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

  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { account, project, task_name, task_detail, due_date, va_ids } = body as {
    account: string;
    project: string;
    task_name: string;
    task_detail?: string;
    due_date?: string;
    va_ids: string[];
  };

  if (!task_name?.trim()) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }
  if (!Array.isArray(va_ids) || va_ids.length === 0) {
    return Response.json(
      { error: "va_ids must be a non-empty array" },
      { status: 400 }
    );
  }

  // Insert the task
  const { data: task, error: taskError } = await supabase
    .from("assigned_tasks")
    .insert({
      account: account ?? null,
      project: project ?? null,
      task_name: task_name.trim(),
      task_detail: task_detail ?? null,
      due_date: due_date ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (taskError)
    return Response.json({ error: taskError.message }, { status: 500 });

  // Insert one assignee row per va_id
  const assigneeRows = va_ids.map((va_id) => ({
    assigned_task_id: task.id,
    va_id,
    status: "pending" as AssignedTaskStatus,
  }));

  const { data: assignees, error: assigneeError } = await supabase
    .from("assigned_task_assignees")
    .insert(assigneeRows)
    .select("id, va_id, status, log_id, notes, assigned_at, updated_at, profiles:va_id(id, full_name, username)");

  if (assigneeError)
    return Response.json({ error: assigneeError.message }, { status: 500 });

  return Response.json({ task: { ...task, assignees: assignees ?? [] } }, { status: 201 });
}
