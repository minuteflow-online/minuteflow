import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

type TemplateRow = {
  id: string;
  title: string;
  task_name?: string | null;
  description: string | null;
  task_detail?: string | null;
  task_notes?: string | null;
  instructions?: string | null;
  instructions_locked?: boolean;
  start_date?: string | null;
  assigned_to: string | null;
  assigned_to_ids?: string[] | null;
  assigned_by: string | null;
  account: string | null;
  project: string | null;
  category: string | null;
  pay_type: string | null;
  recurrence_type: RecurrenceType;
  recurrence_days: string[] | null;
  recurrence_day_of_month: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  assigned_to_profile?: { id: string; full_name: string; username: string } | null;
  assigned_to_profiles?: { id: string; full_name: string; username: string }[] | null;
  assigned_by_profile?: { id: string; full_name: string; username: string } | null;
};

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function normalizeDays(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const days = value.map((day) => String(day).trim()).filter(Boolean);
    return days.length > 0 ? days : null;
  }
  if (typeof value === "string") {
    const days = value.split(",").map((day) => day.trim()).filter(Boolean);
    return days.length > 0 ? days : null;
  }
  return null;
}

function normalizeIds(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const ids = value.map((id) => String(id).trim()).filter(Boolean);
    return ids.length > 0 ? ids : null;
  }
  if (typeof value === "string") {
    const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function booleanOrDefault(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

async function decorateTemplates(rows: TemplateRow[], supabase = serviceClient()) {
  const profileIds = [
    ...new Set(
      rows.flatMap((row) => [row.assigned_by, ...(row.assigned_to_ids ?? []), row.assigned_to]).filter(
        (id): id is string => Boolean(id)
      )
    ),
  ];

  let profilesMap: Record<string, { id: string; full_name: string; username: string }> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", profileIds);
    profilesMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  return rows.map((row) => {
    const assigned_to_ids = row.assigned_to_ids?.filter(Boolean) ?? (row.assigned_to ? [row.assigned_to] : []);
    const assigned_to_profiles = assigned_to_ids
      .map((id) => profilesMap[id])
      .filter((profile): profile is { id: string; full_name: string; username: string } => Boolean(profile));

    return {
      ...row,
      title: row.title ?? row.task_name ?? "",
      description: row.description ?? row.task_detail ?? null,
      task_name: row.task_name ?? row.title ?? null,
      task_detail: row.task_detail ?? row.description ?? null,
      assigned_to_ids,
      assigned_to_profile: assigned_to_profiles[0] ?? null,
      assigned_to_profiles,
      assigned_by_profile: row.assigned_by ? profilesMap[row.assigned_by] ?? null : null,
    };
  });
}

function parseBodyDays(body: Record<string, unknown>): string[] | null {
  return normalizeDays(body.recurrence_days ?? body.custom_days);
}

function parseRecurrenceType(value: unknown): RecurrenceType {
  if (value === "weekly" || value === "monthly" || value === "custom") return value;
  return "daily";
}

function parseId(request: Request, body?: Record<string, unknown>): string | null {
  const { searchParams } = new URL(request.url);
  return (searchParams.get("id") || (typeof body?.id === "string" ? body.id : null)) ?? null;
}

function parseAssignedToIds(body: Record<string, unknown>) {
  const idsFromArray = normalizeIds(body.assigned_to_ids);
  if (idsFromArray && idsFromArray.length > 0) return idsFromArray;
  const idsFromSingle = normalizeIds(body.assigned_to);
  return idsFromSingle ?? [];
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const templates = await decorateTemplates((data ?? []) as TemplateRow[], supabase);
  return Response.json({ templates });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const user = auth.user;

  const body = (await request.json()) as Record<string, unknown>;
  const title = stringOrNull(body.title) ?? stringOrNull(body.task_name) ?? "";
  const assignedToIds = parseAssignedToIds(body);
  const recurrence_type = parseRecurrenceType(body.recurrence_type);
  const recurrence_days = parseBodyDays(body);
  const recurrence_day_of_month =
    typeof body.recurrence_day_of_month === "number"
      ? body.recurrence_day_of_month
      : typeof body.recurrence_day_of_month === "string" && body.recurrence_day_of_month.trim()
        ? Number(body.recurrence_day_of_month)
        : null;

  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (assignedToIds.length === 0) return Response.json({ error: "assigned_to_ids is required" }, { status: 400 });
  if ((recurrence_type === "weekly" || recurrence_type === "custom") && !recurrence_days) {
    return Response.json({ error: "recurrence_days is required for weekly/custom templates" }, { status: 400 });
  }
  if (recurrence_type === "monthly" && !recurrence_day_of_month) {
    return Response.json({ error: "recurrence_day_of_month is required for monthly templates" }, { status: 400 });
  }

  const supabase = serviceClient();
  const payload = {
    title,
    description: stringOrNull(body.description) ?? stringOrNull(body.task_detail),
    task_detail: stringOrNull(body.task_detail) ?? stringOrNull(body.description),
    task_notes: stringOrNull(body.task_notes),
    instructions: stringOrNull(body.instructions),
    instructions_locked: booleanOrDefault(body.instructions_locked, false),
    start_date: stringOrNull(body.start_date),
    assigned_to: assignedToIds[0] ?? null,
    assigned_to_ids: assignedToIds,
    assigned_by: stringOrNull(body.assigned_by) ?? user.id,
    account: stringOrNull(body.account),
    project: stringOrNull(body.project),
    category: stringOrNull(body.category),
    pay_type: stringOrNull(body.pay_type),
    recurrence_type,
    recurrence_days,
    recurrence_day_of_month,
    is_active: booleanOrDefault(body.is_active, true),
  };

  const { data, error } = await supabase
    .from("recurring_task_templates")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const templates = await decorateTemplates([data as TemplateRow], supabase);
  return Response.json({ template: templates[0] }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as Record<string, unknown>;
  const id = parseId(request, body);
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined || body.task_name !== undefined) {
    updates.title = stringOrNull(body.title) ?? stringOrNull(body.task_name);
  }
  if (body.description !== undefined || body.task_detail !== undefined) {
    updates.description = stringOrNull(body.description) ?? stringOrNull(body.task_detail);
  }
  if (body.task_detail !== undefined) updates.task_detail = stringOrNull(body.task_detail);
  if (body.task_notes !== undefined) updates.task_notes = stringOrNull(body.task_notes);
  if (body.instructions !== undefined) updates.instructions = stringOrNull(body.instructions);
  if (body.instructions_locked !== undefined) updates.instructions_locked = booleanOrDefault(body.instructions_locked, false);
  if (body.start_date !== undefined) updates.start_date = stringOrNull(body.start_date);
  if (body.assigned_to_ids !== undefined || body.assigned_to !== undefined) {
    const assignedToIds = parseAssignedToIds(body);
    updates.assigned_to_ids = assignedToIds.length > 0 ? assignedToIds : null;
    updates.assigned_to = assignedToIds[0] ?? null;
  }
  if (body.assigned_by !== undefined) updates.assigned_by = stringOrNull(body.assigned_by);
  if (body.account !== undefined) updates.account = stringOrNull(body.account);
  if (body.project !== undefined) updates.project = stringOrNull(body.project);
  if (body.category !== undefined) updates.category = stringOrNull(body.category);
  if (body.pay_type !== undefined) updates.pay_type = stringOrNull(body.pay_type);
  if (body.recurrence_type) updates.recurrence_type = parseRecurrenceType(body.recurrence_type);
  if (body.recurrence_days !== undefined || body.custom_days !== undefined) updates.recurrence_days = parseBodyDays(body);
  if (body.recurrence_day_of_month !== undefined) {
    updates.recurrence_day_of_month =
      typeof body.recurrence_day_of_month === "number"
        ? body.recurrence_day_of_month
        : typeof body.recurrence_day_of_month === "string" && body.recurrence_day_of_month.trim()
          ? Number(body.recurrence_day_of_month)
          : null;
  }
  if (body.is_active !== undefined) updates.is_active = booleanOrDefault(body.is_active, true);
  if (body.is_paused !== undefined) updates.is_active = !booleanOrDefault(body.is_paused, false);

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  const templates = await decorateTemplates([data as TemplateRow], supabase);
  return Response.json({ template: templates[0] });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const id = parseId(request);
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();
  const { error: nullifyError } = await supabase
    .from("assigned_tasks")
    .update({ recurring_template_id: null })
    .eq("recurring_template_id", id);

  if (nullifyError) {
    return Response.json({ error: nullifyError.message }, { status: 400 });
  }

  const { error } = await supabase.from("recurring_task_templates").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
