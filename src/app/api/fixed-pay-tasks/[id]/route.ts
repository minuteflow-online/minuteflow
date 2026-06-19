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

function isValidStatus(value: unknown): value is FixedPayTaskWithClaimer["status"] {
  return typeof value === "string" && TASK_STATUSES.has(value);
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

  if ("task_name" in body) {
    const taskName = String(body.task_name ?? "").trim();
    if (!taskName) return Response.json({ error: "task_name is required" }, { status: 400 });
    updates.task_name = taskName;
  }
  if ("account" in body) updates.account = normalizeText(body.account);
  if ("category" in body) updates.category = normalizeText(body.category);
  if ("rate" in body) {
    const rate = parseRate(body.rate);
    if (rate === null) return Response.json({ error: "rate is required" }, { status: 400 });
    updates.rate = rate;
  }
  if ("task_detail" in body) updates.task_detail = normalizeText(body.task_detail);
  if ("task_notes" in body) updates.task_notes = normalizeText(body.task_notes);
  if ("link" in body) updates.link = normalizeText(body.link);
  if ("instructions" in body) updates.instructions = normalizeText(body.instructions);
  if ("instructions_locked" in body) updates.instructions_locked = Boolean(body.instructions_locked);
  if ("status" in body) {
    const status = String(body.status ?? "");
    if (!isValidStatus(status)) {
      return Response.json({ error: "status is invalid" }, { status: 400 });
    }
    updates.status = status;
  }
  if ("assigned_to" in body) updates.assigned_to = normalizeText(body.assigned_to);
  if ("assigned_by" in body) updates.assigned_by = normalizeText(body.assigned_by);
  if ("is_active" in body) updates.is_active = Boolean(body.is_active);

  const admin = makeAdminClient();
  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .update(updates)
    .eq("id", taskId)
    .select(TASK_SELECT)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const [task] = await hydrateTaskProfiles(admin, [data as FixedPayTaskWithClaimer]);
  return Response.json({ task });
}
