import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FixedPayTaskWithClaimer } from "@/types/database";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TASK_STATUSES = new Set(["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled", "paid"]);
// Statuses a VA may set on their own claimed task. Revision Needed, Completed,
// Cancelled, and Paid are review/payroll actions — admin only.
const VA_EDITABLE_STATUSES = new Set(["open", "pending", "on_queue", "in_progress", "submitted"]);
const TASK_SELECT =
  "id, task_name, account, category, project_id, rate, is_active, archived_at, deleted_at, task_detail, task_notes, link, instructions, instructions_locked, status, start_date, due_date, end_date, assigned_to, assigned_by, claimed_by, claimed_at, created_by, created_at, updated_at, projects(id, name)";

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
    .select("role, position, pay_rate_type, can_see_available_tasks")
    .eq("id", user.id)
    .single();

  if (error) {
    return { error: Response.json({ error: error.message }, { status: 500 }) as Response };
  }

  return {
    supabase,
    userId: user.id,
    role: profile?.role ?? null,
    position: profile?.position ?? null,
    payRateType: profile?.pay_rate_type ?? null,
    canSeeAvailableTasks: Boolean(profile?.can_see_available_tasks),
  };
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

// Fixed-pay tasks store start_date/due_date as plain dates (no time-of-day),
// so this normalizes to YYYY-MM-DD rather than a full ISO timestamp.
function normalizeDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function matchesTaskView(
  task: { is_active?: boolean | null; archived_at?: string | null; deleted_at?: string | null },
  view: string | null
) {
  if (view === "archived") return Boolean(task.archived_at) && !task.deleted_at;
  if (view === "trash") return Boolean(task.deleted_at);
  if (view === "inactive") return !task.is_active && !task.archived_at && !task.deleted_at;
  if (view === "active") return Boolean(task.is_active) && !task.archived_at && !task.deleted_at;
  return true;
}
async function hydrateTaskProfiles(client: Pick<SupabaseClient, "from">, rows: FixedPayTaskWithClaimer[]) {
  const profileIds = [...new Set(rows.flatMap((row) => [row.claimed_by, row.assigned_to, row.assigned_by, row.created_by]).filter((id): id is string => Boolean(id)))];
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
    created_by_profile: row.created_by ? profileMap[row.created_by] ?? null : null,
  }));
}

export async function GET(request: Request) {
  const auth = await getAuthedProfile();
  if ("error" in auth) return auth.error;

  const { supabase, userId, role } = auth;
  const isAdminOrManager = role === "admin" || role === "manager";
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");

  const { data, error } = await supabase
    .from("fixed_pay_tasks")
    .select(TASK_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = await hydrateTaskProfiles(supabase, (data ?? []) as unknown as FixedPayTaskWithClaimer[]);

  if (!isAdminOrManager) {
    const visibleRows = rows.filter((task) => matchesTaskView(task, "active"));
    const unclaimed = visibleRows.filter((task) => !task.claimed_by);
    const mine = visibleRows.filter((task) => task.claimed_by === userId);

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

  const filteredRows = view ? rows.filter((task) => matchesTaskView(task, view)) : rows;

  return Response.json({
    tasks: filteredRows.map((t) => ({ ...t, claimed_by_me: t.claimed_by === userId })),
  });
}

export async function POST(request: Request) {
  const auth = await getAuthedProfile();
  if ("error" in auth) return auth.error;

  const { role, userId, position, payRateType, canSeeAvailableTasks } = auth;
  const isAdminOrManager = role === "admin" || role === "manager";
  // VAs who see the fixed-pay pool may create tasks into it: per-task/fixed-pay
  // VAs, or hourly VAs with the hybrid "Avail. Tasks" toggle on.
  const isEligibleVa =
    role === "va" && (position === "Per Task VA" || payRateType === "per_task" || canSeeAvailableTasks);
  if (!isAdminOrManager && !isEligibleVa) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const taskName = String(body.task_name ?? "").trim();
  const rate = parseRate(body.rate);
  // Admin-created tasks default to the open pool (anyone can grab). A VA
  // creating their own task is auto-claimed below, so "open" here is just
  // the row's resting status until they move it themselves.
  const status = isAdminOrManager && body.status !== undefined ? String(body.status) : "open";

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
  // A VA creating a task for themselves shouldn't have to grab it from the
  // open pool afterward — claim it immediately, same as hitting "Grab".
  const autoClaim = isEligibleVa && !isAdminOrManager;
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .insert({
      task_name: taskName,
      account: normalizeText(body.account),
      category: normalizeText(body.category),
      project_id: normalizeText(body.project_id),
      rate,
      archived_at: null,
      deleted_at: null,
      task_detail: normalizeText(body.task_detail),
      task_notes: normalizeText(body.task_notes),
      link: normalizeText(body.link),
      instructions: normalizeText(body.instructions),
      instructions_locked: body.instructions_locked === true,
      status,
      start_date: normalizeDate(body.start_date),
      due_date: normalizeDate(body.due_date),
      end_date: normalizeDate(body.end_date),
      assigned_to: isAdminOrManager ? normalizeText(body.assigned_to) : null,
      assigned_by: isAdminOrManager ? normalizeText(body.assigned_by) : null,
      is_active: isAdminOrManager ? body.is_active !== false : true,
      created_by: userId,
      claimed_by: autoClaim ? userId : null,
      claimed_at: autoClaim ? now : null,
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (autoClaim) {
    const { data: assignedTask, error: assignedTaskError } = await admin
      .from("assigned_tasks")
      .insert({
        account: data.account,
        project: data.category,
        task_name: data.task_name,
        task_detail: null,
        task_notes: null,
        due_date: null,
        created_by: userId,
        fixed_pay_task_id: data.id,
      })
      .select("id")
      .single();

    if (assignedTaskError || !assignedTask) {
      await admin.from("fixed_pay_tasks").update({ claimed_by: null, claimed_at: null }).eq("id", data.id);
      return Response.json({ error: assignedTaskError?.message || "Unable to create assigned task" }, { status: 500 });
    }

    const { error: assigneeError } = await admin
      .from("assigned_task_assignees")
      .insert({
        assigned_task_id: assignedTask.id,
        va_id: userId,
        status: "on_queue",
      });

    if (assigneeError) {
      await admin.from("assigned_tasks").delete().eq("id", assignedTask.id);
      await admin.from("fixed_pay_tasks").update({ claimed_by: null, claimed_at: null }).eq("id", data.id);
      return Response.json({ error: assigneeError.message || "Unable to create task assignment" }, { status: 500 });
    }
  }

  const [task] = await hydrateTaskProfiles(admin, [data as unknown as FixedPayTaskWithClaimer]);
  return Response.json({ task }, { status: 201 });
}
