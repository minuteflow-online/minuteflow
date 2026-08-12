import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; todoId: string }> };

async function canAccessTodos(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, userId: string, role?: string | null) {
  if (role === "admin" || role === "manager") return true;

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

// Same re-composition as the list route — kept in sync so editing an
// individual to-do's text or removing one updates the parent task's memo too.
async function syncParentTaskDetail(admin: Pick<SupabaseClient, "from">, taskId: string) {
  const { data: todos } = await admin
    .from("task_todos")
    .select("text")
    .eq("assigned_task_id", taskId)
    .order("sort_order", { ascending: true });

  const composed = (todos ?? []).length > 0
    ? (todos ?? []).map((t) => `- ${t.text}`).join("\n")
    : null;

  if (composed === null) return;

  await admin.from("assigned_tasks").update({ task_detail: composed }).eq("id", taskId);

  const { data: assigneeRows } = await admin
    .from("assigned_task_assignees")
    .select("log_id")
    .eq("assigned_task_id", taskId);

  const logIds = (assigneeRows ?? [])
    .map((r: { log_id: number | null }) => r.log_id)
    .filter((lid): lid is number => typeof lid === "number");

  if (logIds.length > 0) {
    await admin.from("time_logs").update({ client_memo: composed }).in("id", logIds);
  }
}

/**
 * PATCH /api/assigned-tasks/[id]/todos/[todoId]
 * Body: { text?: string, sort_order?: number }
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id, todoId } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile?.role ?? null);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if ("text" in body) {
    const text = String(body.text ?? "").trim();
    if (!text) return Response.json({ error: "text cannot be empty" }, { status: 400 });
    updates.text = text;
  }
  if ("sort_order" in body) {
    updates.sort_order = Number(body.sort_order);
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: todo, error } = await admin
    .from("task_todos")
    .update(updates)
    .eq("id", todoId)
    .eq("assigned_task_id", id)
    .select("id, assigned_task_id, text, sort_order, created_at, created_by")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if ("text" in updates) {
    await syncParentTaskDetail(admin, id);
  }

  return Response.json({ todo });
}

/**
 * DELETE /api/assigned-tasks/[id]/todos/[todoId]
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id, todoId } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile?.role ?? null);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin
    .from("task_todos")
    .delete()
    .eq("id", todoId)
    .eq("assigned_task_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await syncParentTaskDetail(admin, id);

  return new Response(null, { status: 204 });
}
