import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type CallerProfile = { role?: string | null; admin_permissions?: string[] | null } | null;

function isAdminEquivalent(profile: CallerProfile) {
  return profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
}

async function canAccessTodos(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, userId: string, profile: CallerProfile) {
  if (isAdminEquivalent(profile)) return true;

  const { data, error } = await supabase
    .from("assigned_task_assignees")
    .select("id")
    .eq("assigned_task_id", taskId)
    .eq("va_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return Boolean(data);
}

/**
 * GET /api/assigned-tasks/[id]/todos
 * Returns all to-do items for a task, ordered by sort_order. Admin/manager
 * (and permission-granted VAs, see adminPermissions.ts) can view any task;
 * VAs can view tasks assigned to them.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  // Permission-granted plain VAs don't pass the DB's is_admin_or_manager()
  // RLS check (role stays "va"), so read via the service-role client once
  // the app-layer check above has already cleared the caller.
  const readClient = isAdminEquivalent(profile)
    ? createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase;

  const { data, error } = await readClient
    .from("task_todos")
    .select("id, assigned_task_id, text, sort_order, created_at, created_by")
    .eq("assigned_task_id", id)
    .order("sort_order", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const todos = data ?? [];

  // Annotate each to-do with whether this VA has ever logged time against it
  // (any time_logs row with a matching todo_label), so the play button can
  // show a "played before" state.
  let playedLabels = new Set<string>();
  if (todos.length > 0) {
    const { data: taskRow } = await readClient
      .from("assigned_tasks")
      .select("task_name")
      .eq("id", id)
      .single();

    if (taskRow?.task_name) {
      const { data: logs } = await readClient
        .from("time_logs")
        .select("todo_label")
        .eq("user_id", user.id)
        .eq("task_name", taskRow.task_name)
        .not("todo_label", "is", null);
      playedLabels = new Set((logs ?? []).map((l) => l.todo_label as string));
    }
  }

  const annotated = todos.map((t, i) => ({ ...t, played: playedLabels.has(`TD${i + 1}`) }));

  return Response.json({ todos: annotated });
}

/**
 * POST /api/assigned-tasks/[id]/todos
 * Body: { text: string }
 * Adds a new to-do item at the end of the task's list (sort_order = current
 * max + 1). Admin/manager (and permission-granted VAs) can add to any task;
 * VAs can add to tasks assigned to them.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const body = await request.json();
  const text = String(body?.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin
    .from("task_todos")
    .select("sort_order")
    .eq("assigned_task_id", id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSortOrder = existing && existing.length > 0 ? (existing[0].sort_order as number) + 1 : 0;

  const { data: todo, error } = await admin
    .from("task_todos")
    .insert({
      assigned_task_id: Number(id),
      text,
      sort_order: nextSortOrder,
      created_by: user.id,
    })
    .select("id, assigned_task_id, text, sort_order, created_at, created_by")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ todo }, { status: 201 });
}
