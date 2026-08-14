import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; todoId: string }> };

type CallerProfile = { role?: string | null; admin_permissions?: string[] | null } | null;

async function canAccessTodos(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, userId: string, profile: CallerProfile) {
  if (profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management")) return true;

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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id, todoId } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile);
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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id, todoId } = await params;

  try {
    const allowed = await canAccessTodos(supabase, id, user.id, profile);
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

  return new Response(null, { status: 204 });
}
