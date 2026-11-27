import {
  requireClientOrgVaIds,
  serviceClient,
  isResponse,
  orgOwnedLogIds,
  orgVisibleShots,
} from "@/lib/clientAdminAccess";
import { formatDateLocalTZ } from "@/lib/utils";
import { isOnBreak, isOnPersonal } from "@/lib/breakState";

export const dynamic = "force-dynamic";

type ActiveTask = { task_name?: string; account?: string; category?: string; isBreak?: boolean; logId?: unknown } | null;

/**
 * GET /api/client-admin/team-monitor
 * Same per-person card data as admin's Live Team Monitor (status, current
 * task, latest screenshot, today's hours/tasks/screenshots) — scoped to
 * this client's own VAs, and to the work they do *for this org*. A VA who
 * is clocked in on agency or another client's work shows as busy elsewhere,
 * with no task name, and none of that time or those captures count here.
 * Mirrors the status logic in (admin)/admin's own monitorMembers.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds, organizationId } = auth;

  if (vaIds.length === 0) return Response.json({ members: [] });

  const admin = serviceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: tzRow }, { data: profiles }, { data: sessions }, { data: logs }, { data: screenshots }] =
    await Promise.all([
      admin.from("organization_settings").select("timezone").limit(1).single(),
      admin.from("profiles").select("id, full_name").in("id", vaIds),
      admin.from("sessions").select("user_id, clocked_in, active_task").in("user_id", vaIds),
      admin
        .from("time_logs")
        .select("id, user_id, task_name, category, duration_ms, start_time, end_time, form_fill_ms")
        .in("user_id", vaIds)
        .gte("start_time", since)
        .order("start_time", { ascending: false }),
      admin
        .from("task_screenshots")
        .select("id, user_id, drive_file_id, created_at, failure_reason, log_id, submission_id")
        .in("user_id", vaIds)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
    ]);

  const activeLogIds = (sessions ?? [])
    .map((s) => Number((s.active_task as ActiveTask)?.logId))
    .filter((v) => Number.isFinite(v));
  const ownedLogs = await orgOwnedLogIds(admin, organizationId, [
    ...(logs ?? []).map((l) => l.id as number),
    ...activeLogIds,
  ]);
  const orgLogs = (logs ?? []).filter((l) => ownedLogs.has(l.id as number));
  const orgShots = await orgVisibleShots(admin, organizationId, screenshots ?? []);

  const timezone = tzRow?.timezone || "UTC";
  const todayStr = formatDateLocalTZ(new Date(), timezone);

  const members = (profiles ?? []).map((profile) => {
    const session = (sessions ?? []).find((s) => s.user_id === profile.id) ?? null;
    const userLogsToday = orgLogs.filter(
      (l) => l.user_id === profile.id && formatDateLocalTZ(new Date(l.start_time as string), timezone) === todayStr
    );
    const userShotsToday = orgShots.filter(
      (s) => s.user_id === profile.id && formatDateLocalTZ(new Date(s.created_at as string), timezone) === todayStr
    );

    let status: "live" | "personal" | "break" | "off" = "off";
    let currentTask = "No activity today";
    const activeTask = session?.active_task as ActiveTask;
    // Capture Now / Force Clock Out are only offered (and only accepted, see
    // those routes) while the VA is on this org's own task.
    let workingForOrg = false;

    if (session?.clocked_in && activeTask) {
      const forThisOrg = ownedLogs.has(Number(activeTask.logId));
      if (isOnBreak(activeTask)) {
        status = "break";
        currentTask = "On Break";
      } else if (isOnPersonal(activeTask)) {
        status = "personal";
        currentTask = "Personal time";
      } else if (forThisOrg) {
        status = "live";
        workingForOrg = true;
        currentTask = [activeTask.task_name, activeTask.account].filter(Boolean).join(" — ") || "Working";
      } else {
        status = "live";
        currentTask = "Working on another account";
      }
    } else if (userLogsToday.length > 0) {
      currentTask = `Last: ${userLogsToday[0].task_name}`;
    }

    const latestShot = userShotsToday.find((s) => s.drive_file_id) ?? null;

    return {
      profile: { id: profile.id, full_name: profile.full_name },
      status,
      currentTask,
      workingForOrg,
      latestScreenshot: latestShot
        ? { id: latestShot.id, url: `/api/drive-image?id=${latestShot.drive_file_id}`, createdAt: latestShot.created_at }
        : null,
      todayHoursMs: userLogsToday
        .filter((l) => l.category !== "Clock Out")
        .reduce((sum, l) => sum + ((l.duration_ms as number) || 0), 0),
      todayTasks: userLogsToday.filter((l) => l.category !== "Break" && l.category !== "Clock Out").length,
      todayScreenshots: userShotsToday.length,
      // This org's own work today (never another account's) — the dashboard's
      // Your Team "Show tasks" list.
      todayLogs: userLogsToday.map((l) => ({
        id: l.id,
        task_name: l.task_name,
        category: l.category,
        start_time: l.start_time,
        end_time: l.end_time,
        duration_ms: l.duration_ms,
      })),
    };
  });

  const order = { live: 0, personal: 1, break: 2, off: 3 };
  members.sort((a, b) => order[a.status] - order[b.status]);

  return Response.json({ members });
}
