import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

type TemplateRow = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
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
    ...new Set(rows.flatMap((row) => [row.assigned_to, row.assigned_by]).filter((id): id is string => Boolean(id))),
  ];

  let profilesMap: Record<string, { id: string; full_name: string; username: string }> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", profileIds);
    profilesMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  return rows.map((row) => ({
    ...row,
    assigned_to_profile: row.assigned_to ? profilesMap[row.assigned_to] ?? null : null,
    assigned_by_profile: row.assigned_by ? profilesMap[row.assigned_by] ?? null : null,
  }));
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

async function getTemplateById(id: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase.from("recurring_task_templates").select("*").eq("id", id).single();
  if (error || !data) return null;
  const [decorated] = await decorateTemplates([data as TemplateRow], supabase);
  return decorated;
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
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const assigned_to = typeof body.assigned_to === "string" ? body.assigned_to : "";
  const recurrence_type = parseRecurrenceType(body.recurrence_type);
  const recurrence_days = parseBodyDays(body);
  const recurrence_day_of_month = typeof body.recurrence_day_of_month === "number"
    ? body.recurrence_day_of_month
    : typeof body.recurrence_day_of_month === "string" && body.recurrence_day_of_month.trim()
      ? Number(body.recurrence_day_of_month)
      : null;

  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (!assigned_to) return Response.json({ error: "assigned_to is required" }, { status: 400 });
  if ((recurrence_type === "weekly" || recurrence_type === "custom") && !recurrence_days) {
    return Response.json({ error: "recurrence_days is required for weekly/custom templates" }, { status: 400 });
  }
  if (recurrence_type === "monthly" && !recurrence_day_of_month) {
    return Response.json({ error: "recurrence_day_of_month is required for monthly templates" }, { status: 400 });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .insert({
      title,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      assigned_to,
      assigned_by: user.id,
      account: typeof body.account === "string" ? body.account.trim() || null : null,
      project: typeof body.project === "string" ? body.project.trim() || null : null,
      category: typeof body.category === "string" ? body.category.trim() || null : null,
      pay_type: typeof body.pay_type === "string" ? body.pay_type.trim() || null : null,
      recurrence_type,
      recurrence_days,
      recurrence_day_of_month,
      is_active: body.is_active === false ? false : true,
    })
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
  if (typeof body.title === "string") updates.title = body.title.trim();
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (typeof body.assigned_to === "string") updates.assigned_to = body.assigned_to || null;
  if (typeof body.account === "string") updates.account = body.account.trim() || null;
  if (typeof body.project === "string") updates.project = body.project.trim() || null;
  if (typeof body.category === "string") updates.category = body.category.trim() || null;
  if (typeof body.pay_type === "string") updates.pay_type = body.pay_type.trim() || null;
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
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;

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
