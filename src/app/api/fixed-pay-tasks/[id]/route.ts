import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) as Response };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) {
    return { error: Response.json({ error: error.message }, { status: 500 }) as Response };
  }

  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) as Response };
  }

  return { userId: user.id };
}

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if ("task_name" in body) updates.task_name = String(body.task_name ?? "").trim();
  if ("account" in body) updates.account = body.account ? String(body.account).trim() : null;
  if ("category" in body) updates.category = body.category ? String(body.category).trim() : null;
  if ("rate" in body) updates.rate = Number(body.rate);
  if ("is_active" in body) updates.is_active = Boolean(body.is_active);

  if ("task_name" in updates && !updates.task_name) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }
  if ("rate" in updates && !Number.isFinite(updates.rate as number)) {
    return Response.json({ error: "rate is required" }, { status: 400 });
  }

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .update(updates)
    .eq("id", taskId)
    .select("id, task_name, account, category, rate, is_active, claimed_by, claimed_at, created_by, created_at, updated_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ task: data });
}
