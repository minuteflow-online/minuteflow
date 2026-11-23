import {
  requireClientOrgVaIds,
  serviceClient,
  isResponse,
  orgOwnedLogIds,
  orgVisibleShots,
} from "@/lib/clientAdminAccess";
import { formatDateLocalTZ } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/overview
 * Same four stats as admin's Overview tab (Active Now, Total Hours Today,
 * Screenshots Today, Tasks Completed) — scoped to this client's own VAs and
 * to work done for this org only. "Active Now" counts VAs on one of this
 * org's tasks right now, not anyone merely clocked in for someone else.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds, organizationId } = auth;

  if (vaIds.length === 0) {
    return Response.json({ activeCount: 0, totalVAs: 0, todayHoursMs: 0, todayScreenshots: 0, todayTasks: 0 });
  }

  const admin = serviceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: tzRow }, { data: sessions }, { data: logs }, { data: screenshots }] = await Promise.all([
    admin.from("organization_settings").select("timezone").limit(1).single(),
    admin.from("sessions").select("user_id, clocked_in, active_task").in("user_id", vaIds),
    admin
      .from("time_logs")
      .select("id, category, duration_ms, end_time, start_time")
      .in("user_id", vaIds)
      .gte("start_time", since),
    admin
      .from("task_screenshots")
      .select("user_id, log_id, submission_id, created_at")
      .in("user_id", vaIds)
      .gte("created_at", since),
  ]);

  const activeLogIds = (sessions ?? [])
    .filter((s) => s.clocked_in)
    .map((s) => Number((s.active_task as { logId?: unknown } | null)?.logId))
    .filter((v) => Number.isFinite(v));
  const owned = await orgOwnedLogIds(admin, organizationId, [
    ...(logs ?? []).map((l) => l.id as number),
    ...activeLogIds,
  ]);
  const orgShots = await orgVisibleShots(admin, organizationId, screenshots ?? []);

  const timezone = tzRow?.timezone || "UTC";
  const todayStr = formatDateLocalTZ(new Date(), timezone);

  const todayLogs = (logs ?? []).filter(
    (l) => owned.has(l.id as number) && formatDateLocalTZ(new Date(l.start_time as string), timezone) === todayStr
  );
  const activeCount = activeLogIds.filter((id) => owned.has(id)).length;
  const todayHoursMs = todayLogs
    .filter((l) => l.category !== "Clock Out")
    .reduce((sum, l) => sum + ((l.duration_ms as number) || 0), 0);
  const todayTasks = todayLogs.filter((l) => l.end_time && l.category !== "Break" && l.category !== "Clock Out").length;
  const todayScreenshots = orgShots.filter(
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
