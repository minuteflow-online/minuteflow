import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import {
  getTodayBoundsInTimezone,
  getWeekBoundsInTimezone,
  getMonthBoundsInTimezone,
  getYearBoundsInTimezone,
  formatDateLocalTZ,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

type RangeKey = "today" | "week" | "month" | "year";

/**
 * GET /api/client-admin/insights?range=today|week|month|year
 * Hours and submission stats for this client's own org only — every query
 * below filters by organization_id, never anything company-wide. Reuses the
 * same date-bounds helpers the real Insights page uses, so "this week" means
 * the same thing here as it does there.
 */
export async function GET(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") as RangeKey) || "week";

  const admin = serviceClient();
  const { data: tzRow } = await admin.from("organization_settings").select("timezone").limit(1).single();
  const timezone = tzRow?.timezone || "UTC";

  const bounds = {
    today: getTodayBoundsInTimezone,
    week: getWeekBoundsInTimezone,
    month: getMonthBoundsInTimezone,
    year: getYearBoundsInTimezone,
  }[range](timezone);

  const [{ data: logs }, { data: tasks }] = await Promise.all([
    admin
      .from("time_logs")
      .select("user_id, task_name, category, duration_ms, start_time")
      .eq("organization_id", organizationId)
      .gte("start_time", bounds.start)
      .lte("start_time", bounds.end)
      .order("start_time", { ascending: true }),
    admin
      .from("assigned_tasks")
      .select("id, status, updated_at")
      .eq("organization_id", organizationId)
      .gte("updated_at", bounds.start)
      .lte("updated_at", bounds.end),
  ]);

  const billableLogs = (logs ?? []).filter((l) => l.category !== "Clock Out");
  const totalHoursMs = billableLogs.reduce((sum, l) => sum + ((l.duration_ms as number) || 0), 0);
  const taskCount = billableLogs.filter((l) => l.category !== "Break").length;

  // Daily trend — one bucket per calendar day in the range, in the org's timezone.
  const dailyMap = new Map<string, number>();
  for (const l of billableLogs) {
    const day = formatDateLocalTZ(new Date(l.start_time as string), timezone);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + ((l.duration_ms as number) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, ms]) => ({ date, ms }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-VA breakdown.
  const vaIds = Array.from(new Set(billableLogs.map((l) => l.user_id as string)));
  const { data: profiles } = vaIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", vaIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  const perVaMap = new Map<string, number>();
  for (const l of billableLogs) {
    const id = l.user_id as string;
    perVaMap.set(id, (perVaMap.get(id) ?? 0) + ((l.duration_ms as number) || 0));
  }
  const perVa = Array.from(perVaMap.entries())
    .map(([id, ms]) => ({ vaId: id, vaName: nameById.get(id) ?? "Unknown", ms }))
    .sort((a, b) => b.ms - a.ms);

  const submitted = (tasks ?? []).filter((t) => t.status === "submitted" || t.status === "reviewing").length;
  const approved = (tasks ?? []).filter((t) => t.status === "approved" || t.status === "completed").length;
  const revisionRequested = (tasks ?? []).filter((t) => t.status === "revision_needed").length;

  return Response.json({
    range,
    totalHoursMs,
    taskCount,
    daily,
    perVa,
    submissions: { submitted, approved, revisionRequested },
  });
}
