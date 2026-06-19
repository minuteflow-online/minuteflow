import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AssignedTaskStatus =
  | "pending"
  | "on_queue"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "revision_needed"
  | "approved"
  | "completed"
  | "paid"
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
  profiles?: { id: string; full_name: string; username: string }[] | null;
};

type TaskRow = {
  id: string;
  account: string | null;
  project: string | null;
  task_name: string;
  task_detail: string | null;
  task_notes: string | null;
  due_date: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_task_assignees: AssigneeRow[];
};

function matchesTaskView(
  task: { archived_at?: string | null; deleted_at?: string | null },
  view: string | null
) {
  if (view === "archived") return Boolean(task.archived_at) && !task.deleted_at;
  if (view === "trash") return Boolean(task.deleted_at);
  return !task.archived_at && !task.deleted_at;
}

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
  const viewParam = searchParams.get("view");
  const selfOnly = searchParams.get("selfOnly") === "true";
  const unassignedOnly = searchParams.get("unassigned") === "true";

  const assigneeSelect =
    "id, va_id, status, log_id, notes, assigned_at, updated_at, instructions, instructions_locked";

  const formatAdminTaskRows = async (data: Array<Record<string, unknown>>) => {
    const allVaIds = [
      ...new Set(
        data.flatMap((t) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((t as any).assigned_task_assignees ?? []).map((a: AssigneeRow) => a.va_id)
        )
      ),
    ];
    let profilesMap: Record<string, { id: string; full_name: string; username: string }> = {};
    if (allVaIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, username")
        .in("id", allVaIds);
      profilesMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));
    }

    return data.map((task) => ({
      ...task,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assigned_task_assignees: ((task as any).assigned_task_assignees ?? []).map((a: AssigneeRow) => ({
        ...a,
        profiles: profilesMap[a.va_id] ?? null,
      })),
    })) as unknown as TaskRow[];
  };

  if (unassignedOnly) {
    const { data, error } = await supabase
      .from("assigned_tasks")
      .select(
        `id, account, project, task_name, task_detail, task_notes, due_date, archived_at, deleted_at, created_by, created_at, updated_at, assigned_by, instructions, instructions_locked, fixed_pay_task_id, fixed_pay_tasks(rate), assigned_by_profile:profiles(id, full_name, username),
         assigned_task_assignees(${assigneeSelect})`
      )
      .order("created_at", { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const result = await formatAdminTaskRows((data ?? []).filter((task) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assignees = ((task as any).assigned_task_assignees ?? []) as AssigneeRow[];
      return assignees.length === 0;
    }));

    return Response.json({ tasks: result.filter((task) => matchesTaskView(task, viewParam)) });
  }

  const isAdminOrManager =
    profile?.role === "admin" || profile?.role === "manager";

  if (isAdminOrManager && !selfOnly) {
    const query = supabase
      .from("assigned_tasks")
      .select(
        `id, account, project, task_name, task_detail, task_notes, due_date, archived_at, deleted_at, created_by, created_at, updated_at, assigned_by, instructions, instructions_locked, fixed_pay_task_id, fixed_pay_tasks(rate), assigned_by_profile:profiles(id, full_name, username),
         assigned_task_assignees(${assigneeSelect})`
      )
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let result = await formatAdminTaskRows(data ?? []);

    if (vaIdParam) {
      result = result
        .map((task) => ({
          ...task,
          assigned_task_assignees: task.assigned_task_assignees.filter(
            (a) => a.va_id === vaIdParam
          ),
        }))
        .filter((task) => task.assigned_task_assignees.length > 0);
    }

    if (statusParam) {
      result = result
        .map((task) => ({
          ...task,
          assigned_task_assignees: task.assigned_task_assignees.filter(
            (a) => a.status === statusParam
          ),
        }))
        .filter((task) => task.assigned_task_assignees.length > 0);
    }

    result = result.filter((task) => matchesTaskView(task, viewParam));

    return Response.json({ tasks: result });
  }

  // VA: return own rows plus collaborative rows from profiles marked visible
  // for collaboration.
  let assigneeQuery = supabase
    .from("assigned_task_assignees")
    .select(
      `id, va_id, status, log_id, notes, assigned_at, updated_at,
       assigned_tasks(id, account, project, task_name, task_detail, task_notes, due_date, archived_at, deleted_at, created_by, created_at, updated_at, assigned_by, instructions, instructions_locked, fixed_pay_task_id, fixed_pay_tasks(rate), assigned_by_profile:profiles(id, full_name, username))`
    )
    .eq("va_id", user.id)
    .order("assigned_at", { ascending: false });

  if (statusParam) {
    assigneeQuery = assigneeQuery.eq("status", statusParam);
  }

  const { data: assigneeData, error: assigneeError } = await assigneeQuery;
  if (assigneeError) {
    return Response.json({ error: assigneeError.message }, { status: 500 });
  }

  const { data: collabProfiles, error: collabProfileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("visible_for_collaboration", true)
    .neq("id", user.id);

  if (collabProfileError) {
    return Response.json({ error: collabProfileError.message }, { status: 500 });
  }

  const collabVaIds = (collabProfiles ?? []).map((profile) => profile.id);
  const profileNameMap = Object.fromEntries(
    (collabProfiles ?? []).map((profile) => [profile.id, profile.full_name])
  );

  let collabData: AssigneeRow[] = [];
  if (collabVaIds.length > 0) {
    let collabQuery = supabase
      .from("assigned_task_assignees")
      .select(
        `id, va_id, status, log_id, notes, assigned_at, updated_at,
         assigned_tasks(id, account, project, task_name, task_detail, task_notes, due_date, archived_at, deleted_at, created_by, created_at, updated_at, assigned_by, instructions, instructions_locked, fixed_pay_task_id, fixed_pay_tasks(rate), assigned_by_profile:profiles(id, full_name, username))`
      )
      .in("va_id", collabVaIds)
      .order("assigned_at", { ascending: false });

    if (statusParam) {
      collabQuery = collabQuery.eq("status", statusParam);
    }

    const { data, error } = await collabQuery;
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    collabData = data ?? [];
  }

  const combined = [
    ...((assigneeData ?? []).map((task) => ({
      ...task,
      is_collaborative: false,
      collaborator_name: null,
    })) as Array<AssigneeRow & { is_collaborative: false; collaborator_name: null }>),
    ...(collabData.map((task) => ({
      ...task,
      is_collaborative: true,
      collaborator_name: profileNameMap[task.va_id] ?? null,
    })) as Array<AssigneeRow & { is_collaborative: true; collaborator_name: string | null }>),
  ];

  const filtered = combined.filter((task) =>
    matchesTaskView(
      ((task as unknown) as { assigned_tasks: { archived_at?: string | null; deleted_at?: string | null } })
        .assigned_tasks,
      viewParam
    )
  );

  return Response.json({ tasks: filtered });
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

  const isAdminOrManagerPost =
    profile?.role === "admin" || profile?.role === "manager";
  const isVaPost = profile?.role === "va";

  // VAs can only self-assign; admins/managers can assign to anyone
  if (!isAdminOrManagerPost && !isVaPost) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    account,
    project,
    task_name,
    task_detail,
    task_notes,
    due_date,
    assigned_by,
    instructions,
    instructions_locked,
    fixed_pay_task_id,
    va_ids: rawVaIds,
  } = body as {
    account: string;
    project: string;
    task_name: string;
    task_detail?: string;
    task_notes?: string;
    due_date?: string;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
    fixed_pay_task_id?: number | null;
    va_ids?: string[];
  };

  // VAs always self-assign regardless of what va_ids was sent
  const va_ids: string[] = isVaPost ? [user.id] : (rawVaIds ?? []);

  if (!task_name?.trim()) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }

  // Use service-role admin client for inserts so that RLS JWT-forwarding
  // issues on the server don't block authenticated users. Auth is already
  // verified above at the application layer.
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Insert the task
  const { data: task, error: taskError } = await adminSupabase
    .from("assigned_tasks")
    .insert({
      account: account ?? null,
      project: project ?? null,
      task_name: task_name.trim(),
      task_detail: task_detail ?? null,
      task_notes: task_notes ?? null,
      due_date: due_date ?? null,
      assigned_by: (assigned_by ?? user.id) as string,
      instructions: instructions ?? null,
      instructions_locked: Boolean(instructions_locked),
      fixed_pay_task_id: fixed_pay_task_id ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (taskError)
    return Response.json({ error: taskError.message }, { status: 500 });

  // Insert one assignee row per va_id
  let assignees = [] as Array<{
    id: string;
    va_id: string;
    status: AssignedTaskStatus;
    log_id: number | null;
    notes: string | null;
    assigned_at: string | null;
    updated_at: string | null;
    instructions?: string | null;
    instructions_locked?: boolean | null;
  }>;

  if (va_ids.length > 0) {
    const assigneeRows = va_ids.map((va_id) => ({
      assigned_task_id: task.id,
      va_id,
      status: "pending" as AssignedTaskStatus,
    }));

    const { data: insertedAssignees, error: assigneeError } = await adminSupabase
      .from("assigned_task_assignees")
      .insert(assigneeRows)
      .select("id, va_id, status, log_id, notes, assigned_at, updated_at, instructions, instructions_locked");

    if (assigneeError)
      return Response.json({ error: assigneeError.message }, { status: 500 });

    assignees = insertedAssignees ?? [];
  }

  return Response.json({ task: { ...task, assigned_task_assignees: assignees } }, { status: 201 });
}
