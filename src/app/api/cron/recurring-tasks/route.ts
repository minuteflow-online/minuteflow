import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly" | "every_2_months" | "every_3_months";

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

function daysBetweenDates(startDateStr: string, todayStr: string): number {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(todayStr + "T00:00:00Z");
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function monthsBetweenDates(startDateStr: string, todayStr: string): number {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(todayStr + "T00:00:00Z");
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

function normalizeAssignedToIds(template: TemplateRow) {
  const ids = template.assigned_to_ids?.filter(Boolean) ?? [];
  if (ids.length > 0) return ids;
  return template.assigned_to ? [template.assigned_to] : [];
}

function isTemplateDueToday(template: TemplateRow, dayOfMonth: number, today: string) {
  if (!template.is_active) return false;
  if (!template.start_date || today < template.start_date) return false;

  const daysSince = daysBetweenDates(template.start_date, today);
  const monthsSince = monthsBetweenDates(template.start_date, today);

  switch (template.recurrence_type) {
    case "daily":
      return true;
    case "weekly":
      return daysSince % 7 === 0;
    case "biweekly":
      return daysSince % 14 === 0;
    case "monthly":
      return template.recurrence_day_of_month === dayOfMonth && monthsSince % 1 === 0;
    case "every_2_months":
      return template.recurrence_day_of_month === dayOfMonth && monthsSince >= 0 && monthsSince % 2 === 0;
    case "every_3_months":
      return template.recurrence_day_of_month === dayOfMonth && monthsSince >= 0 && monthsSince % 3 === 0;
    default:
      return false;
  }
}

async function buildDueDate(timeZone: string) {
  const now = new Date();
  const parts = getTimezoneParts(now, timeZone);
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
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
  const { today, dayOfMonth } = await buildDueDate(timeZone);

  // Generate tasks 1 day BEFORE the scheduled date
  const tomorrowDate = new Date();
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowParts = getTimezoneParts(tomorrowDate, timeZone);
  const tomorrow = `${tomorrowParts.year}-${tomorrowParts.month}-${tomorrowParts.day}`;
  const tomorrowDayOfMonth = Number(tomorrowParts.day);

  // Suppress unused-variable warnings — today/dayOfMonth kept for reference
  void today; void dayOfMonth;

  const { data: templates, error: templateError } = await supabase
    .from("recurring_task_templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (templateError) {
    return Response.json({ error: templateError.message }, { status: 500 });
  }

  const dueTemplates = ((templates ?? []) as TemplateRow[]).filter((template) =>
    isTemplateDueToday(template, tomorrowDayOfMonth, tomorrow)
  );

  if (dueTemplates.length === 0) {
    return Response.json({ created: 0, skipped: 0, message: "No recurring templates due today" });
  }

  const templateIds = dueTemplates.map((template) => template.id);
  const { data: existingTasks, error: existingError } = await supabase
    .from("assigned_tasks")
    .select("id, recurring_template_id, due_date")
    .in("recurring_template_id", templateIds)
    .eq("due_date", tomorrow);

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
        due_date: tomorrow,
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

    const { data: templateAttachments, error: attachmentFetchError } = await supabase
      .from("recurring_template_attachments")
      .select("filename, storage_path, file_size, mime_type, uploaded_by")
      .eq("template_id", template.id)
      .order("uploaded_at", { ascending: true });

    if (attachmentFetchError) {
      await supabase.from("assigned_task_assignees").delete().eq("assigned_task_id", task.id);
      await supabase.from("assigned_tasks").delete().eq("id", task.id);
      continue;
    }

    if ((templateAttachments ?? []).length > 0) {
      const { error: attachmentInsertError } = await supabase.from("assigned_task_attachments").insert(
        (templateAttachments ?? []).map((attachment) => ({
          assigned_task_id: task.id,
          filename: attachment.filename,
          storage_path: attachment.storage_path,
          file_size: attachment.file_size,
          mime_type: attachment.mime_type,
          uploaded_by: attachment.uploaded_by ?? template.assigned_by,
        }))
      );

      if (attachmentInsertError) {
        await supabase.from("assigned_task_assignees").delete().eq("assigned_task_id", task.id);
        await supabase.from("assigned_tasks").delete().eq("id", task.id);
        continue;
      }
    }

    created++;
    createdTemplates.push(template.id);
  }

  return Response.json({
    created,
    skipped: dueTemplates.length - created,
    dueTemplates: dueTemplates.length,
    createdTemplateIds: createdTemplates,
    date: tomorrow,
  });
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
