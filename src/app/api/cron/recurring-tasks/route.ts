import { createClient as createAdminClient } from "@supabase/supabase-js";
import { generateOccurrences } from "@/lib/recurringOccurrences";
import type { NextRequest } from "next/server";
import { orgWallClockToUtc } from "@/lib/taskSchedule";

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
  planned_minutes?: number | null;
  start_date?: string | null;
  assigned_to: string | null;
  assigned_to_ids?: string[] | null;
  assigned_by: string | null;
  account: string | null;
  project: string | null;
  project_id: string | null;
  category: string | null;
  pay_type: string | null;
  recurrence_type: RecurrenceType;
  // integer[] in Postgres, 0=Sun..6=Sat — see recurringOccurrences.ts.
  recurrence_days: number[] | null;
  recurrence_day_of_month: number | null;
  link?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  due_time?: string | null;
  end_date?: string | null;
  review_required?: boolean | null;
  is_active: boolean;
  paused_until?: string | null;
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

  // Tops up the same window the save-time generation fills. Both go through
  // generateOccurrences, so "when does a recurring task appear" has one answer
  // and a re-run converges instead of duplicating.
  // A pause whose date has passed ends here, so nobody has to remember to
  // press Resume. Generation would resume on its own either way — fallsOn only
  // suppresses dates inside the window — but the template would sit there
  // labelled Paused while quietly producing tasks.
  const expired = ((templates ?? []) as TemplateRow[]).filter(
    (t) => !t.is_active && t.paused_until && t.paused_until < today
  );
  for (const template of expired) {
    await supabase
      .from("recurring_task_templates")
      .update({ is_active: true, paused_until: null })
      .eq("id", template.id);
    template.is_active = true;
    template.paused_until = null;
  }

  let created = 0;
  const createdTemplates: string[] = [];
  for (const template of (templates ?? []) as TemplateRow[]) {
    // Paused templates still go through: a pause with an end date lets the
    // dates after it generate, and generateOccurrences is what knows the
    // difference. Only an open-ended pause produces nothing.
    if (!template.is_active && !template.paused_until) continue;
    const result = await generateOccurrences(
      supabase,
      template as unknown as Parameters<typeof generateOccurrences>[1],
      today
    );
    if (result.created > 0) {
      created += result.created;
      createdTemplates.push(template.id);
    }
  }

  void dayOfMonth;

  return Response.json({
    created,
    templates: (templates ?? []).length,
    createdTemplateIds: createdTemplates,
    from: today,
  });
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
