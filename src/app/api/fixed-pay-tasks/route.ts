import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FixedPayTaskWithClaimer } from "@/types/database";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TASK_STATUSES = new Set(["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled"]);
const TASK_SELECT =
  "id, task_name, account, category, rate, is_active, task_detail, task_notes, link, instructions, instructions_locked, status, assigned_to, assigned_by, claimed_by, claimed_at, created_by, created_at, updated_at";

type ProfileSummary = { id: string; full_name: string; username: string };

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

function normalizeText(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseRate(value: unknown): number | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function hydrateTaskProfiles(client: Pick<SupabaseClient, "from">, rows: FixedPayTaskWithClaimer[]) {
  const profileIds = [...new Set(rows.flatMap((row) => [row.claimed_by, row.assigned_to, row.assigned_by]).filter((id): id is string => Boolean(id)))];
  let profileMap: Record<string, ProfileSummary> = {};

  if (profileIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, username")
      .in("id", profileIds);

    profileMap = Object.fromEntries((profiles ?? []).map((profile: ProfileSummary) => [profile.id, profile]));
  }

  return rows.map((row) => ({
    ...row,
    assigned_by_profile: row.assigned_by ? profileMap[row.assigned_by] ?? null : null,
    claimed_by_profile: row.claimed_by ? profileMap[row.claimed_by] ?? null : null,
    assigned_to_profile: row.assigned_to ? profileMap[row.assigned_to] ?? null : null,
  }));
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ("error" in auth) return auth.error;

  const { supabase, userId, role } = auth;
  const isAdminOrManager = role === "admin" || role === "manager";

  const { data, error } = await supabase
    .from("fixed_pay_tasks")
    .select(TASK_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = await hydrateTaskProfiles(supabase, (data ?? []) as FixedPayTaskWithClaimer[]);

  if (!isAdminOrManager) {
    const unclaimed = rows.filter((task) => task.is_active && !task.claimed_by);
    const mine = rows.filter((task) => task.is_active && task.claimed_by === userId);

    const mineIds = mine.map((t) => t.id);
    let atMap: Record<string | number, number> = {};
    if (mineIds.length > 0) {
      const { data: atRows } = await supabase
        .from("assigned_tasks")
        .select("id, fixed_pay_task_id")
        .in("fixed_pay_task_id", mineIds);
      atMap = Object.fromEntries((atRows ?? []).map((r: { fixed_pay_task_id: string | number; id: number }) => [r.fixed_pay_task_id, r.id]));
    }

    return Response.json({
      tasks: [
        ...unclaimed.map((t) => ({ ...t, claimed_by_me: false, assigned_task_id: null })),
        ...mine.map((t) => ({ ...t, claimed_by_me: true, assigned_task_id: atMap[t.id] ?? null })),
      ],
    });
  }

  return Response.json({ tasks: rows });
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
  const rate = parseRate(body.rate);
  const status = body.status === undefined ? "open" : String(body.status);

  if (!taskName) {
    return Response.json({ error: "task_name is required" }, { status: 400 });
  }
  if (rate === null) {
    return Response.json({ error: "rate is required" }, { status: 400 });
  }
  if (!TASK_STATUSES.has(status)) {
    return Response.json({ error: "status is invalid" }, { status: 400 });
  }

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .insert({
      task_name: taskName,
      account: normalizeText(body.account),
      category: normalizeText(body.category),
      rate,
      task_detail: normalizeText(body.task_detail),
      task_notes: normalizeText(body.task_notes),
      link: normalizeText(body.link),
      instructions: normalizeText(body.instructions),
      instructions_locked: body.instructions_locked === true,
      status,
      assigned_to: normalizeText(body.assigned_to),
      assigned_by: normalizeText(body.assigned_by),
      is_active: body.is_active !== false,
      created_by: userId,
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const [task] = await hydrateTaskProfiles(admin, [data as FixedPayTaskWithClaimer]);
  return Response.json({ task }, { status: 201 });
}
