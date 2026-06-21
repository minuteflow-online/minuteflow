import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

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
};

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getCronSecret(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return false;
  }
  return true;
}

function getTimezoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: String(mapped.weekday || "").toLowerCase(),
    year: mapped.year || "0000",
    month: mapped.month || "01",
    day: mapped.day || "01",
  };
}

function weekdayToIndex(value: string) {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    0: 0,
    monday: 1,
    mon: 1,
    1: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    2: 2,
    wednesday: 3,
    wed: 3,
    3: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    4: 4,
    friday: 5,
    fri: 5,
    5: 5,
    saturday: 6,
    sat: 6,
    6: 6,
  };
  return map[normalized];
}

function normalizeAssignedToIds(template: TemplateRow) {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

function isTemplateDueToday(template: TemplateRow, weekday: string, weekdayIndex: number, dayOfMonth: number, today: string) {
  if (!template.is_active) return false;
  if (template.start_date && today < template.start_date) return false;

  switch (template.recurrence_type) {
    case "daily":
      return true;
    case "monthly":
      return template.recurrence_day_of_month === dayOfMonth;
    case "weekly":
    case "custom": {
      const days = template.recurrence_days ?? [];
      return days.some((day) => {
        const normalized = day.trim().toLowerCase();
        return normalized === weekday || weekdayToIndex(normalized) === weekdayIndex;
      });
    }
    default:
      return false;
  }
}

async function buildDueDate(timeZone: string) {
  const now = new Date();
  const parts = getTimezoneParts(now, timeZone);
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    weekdayIndex: weekdayToIndex(parts.weekday),
    dayOfMonth: Number(parts.day),
  };
}

async function handleCron(request: NextRequest) {
  if (!getCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  const { data: settings } = await supabase
    .from("organization_settings")
    .select("timezone")
    .limit(1)
    .single();
  const timeZone = settings?.timezone || "UTC";
  const { today, weekday, weekdayIndex, dayOfMonth } = await buildDueDate(timeZone);

  const { data: templates, error: templateError } = await supabase
    .from("recurring_task_templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (templateError) {
    return Response.json({ error: templateError.message }, { status: 500 });
  }

  const dueTemplates = ((templates ?? []) as TemplateRow[]).filter((template) =>
    isTemplateDueToday(template, weekday, weekdayIndex, dayOfMonth, today)
  );

  if (dueTemplates.length === 0) {
    return Response.json({ created: 0, skipped: 0, message: "No recurring templates due today" });
  }

  const templateIds = dueTemplates.map((template) => template.id);
  const { data: existingTasks, error: existingError } = await supabase
    .from("assigned_tasks")
    .select("id, recurring_template_id, due_date")
    .in("recurring_template_id", templateIds)
    .eq("due_date", today);

  if (existingError) {
    return Response.json({ error: existingError.message }, { status: 500 });
  }

  const alreadyCreated = new Set((existingTasks ?? []).map((task) => task.recurring_template_id as string));
  const createTemplates = dueTemplates.filter((template) => !alreadyCreated.has(template.id));

  let created = 0;
  const createdTemplates: string[] = [];

  for (const template of createTemplates) {
    const assigneeIds = normalizeAssignedToIds(template);
    if (assigneeIds.length === 0) {
      continue;
    }

    const { data: task, error: taskError } = await supabase
      .from("assigned_tasks")
      .insert({
        account: template.account,
        project: template.project,
        task_name: template.title,
        task_detail: template.task_detail ?? template.description,
        task_notes: template.task_notes,
        due_date: today,
        assigned_by: template.assigned_by,
        instructions: template.instructions,
        instructions_locked: Boolean(template.instructions_locked),
        recurring_template_id: template.id,
        created_by: template.assigned_by,
        status: "pending",
      })
      .select("id")
      .single();

    if (taskError || !task) {
      continue;
    }

    const { error: assigneeError } = await supabase
      .from("assigned_task_assignees")
      .insert(
        assigneeIds.map((va_id) => ({
          assigned_task_id: task.id,
          va_id,
          status: "pending",
        }))
      );

    if (assigneeError) {
      await supabase.from("assigned_tasks").delete().eq("id", task.id);
      continue;
    }

    created++;
    createdTemplates.push(template.id);
  }

  return Response.json({
    created,
    skipped: dueTemplates.length - created,
    dueTemplates: dueTemplates.length,
    createdTemplateIds: createdTemplates,
    date: today,
  });
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
