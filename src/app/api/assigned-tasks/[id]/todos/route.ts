import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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

/**
 * GET /api/assigned-tasks/[id]/todos
 * Returns all to-do items for a task, ordered by sort_order. Admin/manager
 * can view any task; VAs can view tasks assigned to them.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile?.role ?? null);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("task_todos")
    .select("id, assigned_task_id, text, sort_order, created_at, created_by")
    .eq("assigned_task_id", id)
    .order("sort_order", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ todos: data ?? [] });
}

/**
 * POST /api/assigned-tasks/[id]/todos
 * Body: { text: string }
 * Adds a new to-do item at the end of the task's list (sort_order = current
 * max + 1). Admin/manager can add to any task; VAs can add to tasks
 * assigned to them.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile?.role ?? null);
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
