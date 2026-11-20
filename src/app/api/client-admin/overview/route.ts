import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import { formatDateLocalTZ } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/overview
 * Same four stats as admin's Overview tab (Active Now, Total Hours Today,
 * Screenshots Today, Tasks Completed) — scoped to this client's own VAs only.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds } = auth;

  if (vaIds.length === 0) {
    return Response.json({ activeCount: 0, totalVAs: 0, todayHoursMs: 0, todayScreenshots: 0, todayTasks: 0 });
  }

  const admin = serviceClient();
  const [{ data: tzRow }, { data: sessions }, { data: logs }, { data: screenshots }] = await Promise.all([
    admin.from("organization_settings").select("timezone").limit(1).single(),
    admin.from("sessions").select("user_id, clocked_in").in("user_id", vaIds),
    admin
      .from("time_logs")
      .select("category, duration_ms, end_time, start_time")
      .in("user_id", vaIds)
      .gte("start_time", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    admin.from("task_screenshots").select("created_at").in("user_id", vaIds),
  ]);

  const timezone = tzRow?.timezone || "UTC";
  const todayStr = formatDateLocalTZ(new Date(), timezone);

  const todayLogs = (logs ?? []).filter((l) => formatDateLocalTZ(new Date(l.start_time as string), timezone) === todayStr);
  const activeCount = (sessions ?? []).filter((s) => s.clocked_in).length;
  const todayHoursMs = todayLogs
    .filter((l) => l.category !== "Clock Out")
    .reduce((sum, l) => sum + ((l.duration_ms as number) || 0), 0);
  const todayTasks = todayLogs.filter((l) => l.end_time && l.category !== "Break" && l.category !== "Clock Out").length;
  const todayScreenshots = (screenshots ?? []).filter(
    (s) => formatDateLocalTZ(new Date(s.created_at as string), timezone) === todayStr
  ).length;

  return Response.json({
    activeCount,
    totalVAs: vaIds.length,
    todayHoursMs,
    todayScreenshots,
    todayTasks,
  });
}
