import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
interface FixedPayTaskWithClaimer {
  id: string;
  task_name: string;
  account: string | null;
  category: string | null;
  rate: number;
  is_active: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function getAuthedProfile() {
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

  return { supabase, userId: user.id, role: profile?.role ?? null };
}

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ("error" in auth) return auth.error;

  const { supabase, userId, role } = auth;
  const isAdminOrManager = role === "admin" || role === "manager";

  const { data, error } = await supabase
    .from("fixed_pay_tasks")
    .select("id, task_name, account, category, rate, is_active, claimed_by, claimed_at, created_by, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as FixedPayTaskWithClaimer[];

  if (!isAdminOrManager) {
    return Response.json({
      tasks: rows.filter((task) => task.is_active && !task.claimed_by),
    });
  }

  const claimerIds = [...new Set(rows.map((task) => task.claimed_by).filter((id): id is string => Boolean(id)))];
  let claimerMap: Record<string, { id: string; full_name: string; username: string }> = {};
  if (claimerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", claimerIds);
    claimerMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  return Response.json({
    tasks: rows.map((task) => ({
      ...task,
      claimed_by_profile: task.claimed_by ? claimerMap[task.claimed_by] ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await getAuthedProfile();
  if ("error" in auth) return auth.error;

  const { role, userId } = auth;
  if (role !== "admin" && role !== "manager") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const taskName = String(body.task_name ?? "").trim();
  const rate = Number(body.rate);

  if (!taskName) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }
  if (!Number.isFinite(rate)) {
    return Response.json({ error: "rate is required" }, { status: 400 });
  }

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .insert({
      task_name: taskName,
      account: body.account ? String(body.account).trim() : null,
      category: body.category ? String(body.category).trim() : null,
      rate,
      is_active: body.is_active !== false,
      created_by: userId,
    })
    .select("id, task_name, account, category, rate, is_active, claimed_by, claimed_at, created_by, created_at, updated_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ task: data }, { status: 201 });
}
