import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";
import { formatDateLocalTZ } from "@/lib/utils";
import { isOnBreak, isOnPersonal } from "@/lib/breakState";

export const dynamic = "force-dynamic";

type ActiveTask = { task_name?: string; account?: string; category?: string; isBreak?: boolean } | null;

/**
 * GET /api/client-admin/team-monitor
 * Same per-person card data as admin's Live Team Monitor (status, current
 * task, latest screenshot, today's hours/tasks/screenshots) — scoped to
 * this client's own VAs only. Mirrors the status logic in (admin)/admin's
 * own monitorMembers computation so the two never drift in meaning.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds } = auth;

  if (vaIds.length === 0) return Response.json({ members: [] });

  const admin = serviceClient();
  const [{ data: tzRow }, { data: profiles }, { data: sessions }, { data: logs }, { data: screenshots }] =
    await Promise.all([
      admin.from("organization_settings").select("timezone").limit(1).single(),
      admin.from("profiles").select("id, full_name").in("id", vaIds),
      admin.from("sessions").select("user_id, clocked_in, active_task").in("user_id", vaIds),
      admin
        .from("time_logs")
        .select("user_id, task_name, category, duration_ms, start_time, form_fill_ms")
        .in("user_id", vaIds)
        .gte("start_time", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("start_time", { ascending: false }),
      admin
        .from("task_screenshots")
        .select("id, user_id, drive_file_id, created_at, failure_reason")
        .in("user_id", vaIds)
        .order("created_at", { ascending: false }),
    ]);

  const timezone = tzRow?.timezone || "UTC";
  const todayStr = formatDateLocalTZ(new Date(), timezone);

  const members = (profiles ?? []).map((profile) => {
    const session = (sessions ?? []).find((s) => s.user_id === profile.id) ?? null;
    const userLogsToday = (logs ?? []).filter(
      (l) => l.user_id === profile.id && formatDateLocalTZ(new Date(l.start_time as string), timezone) === todayStr
    );
    const userShotsToday = (screenshots ?? []).filter(
      (s) => s.user_id === profile.id && formatDateLocalTZ(new Date(s.created_at as string), timezone) === todayStr
    );

    let status: "live" | "personal" | "break" | "off" = "off";
    let currentTask = "No activity today";
    const activeTask = session?.active_task as ActiveTask;

    if (session?.clocked_in && activeTask) {
      if (isOnBreak(activeTask)) {
        status = "break";
        currentTask = "On Break";
      } else if (isOnPersonal(activeTask)) {
        status = "personal";
        currentTask = [activeTask.task_name, activeTask.account].filter(Boolean).join(" — ") || "Personal";
      } else {
        status = "live";
        currentTask = [activeTask.task_name, activeTask.account].filter(Boolean).join(" — ") || "Working";
      }
    } else if (userLogsToday.length > 0) {
      currentTask = `Last: ${userLogsToday[0].task_name}`;
    }

    const latestShot = userShotsToday.find((s) => s.drive_file_id) ?? null;

    return {
      profile: { id: profile.id, full_name: profile.full_name },
      status,
      currentTask,
      latestScreenshot: latestShot
        ? { id: latestShot.id, url: `/api/drive-image?id=${latestShot.drive_file_id}`, createdAt: latestShot.created_at }
        : null,
      todayHoursMs: userLogsToday
        .filter((l) => l.category !== "Clock Out")
        .reduce((sum, l) => sum + ((l.duration_ms as number) || 0), 0),
      todayTasks: userLogsToday.filter((l) => l.category !== "Break" && l.category !== "Clock Out").length,
      todayScreenshots: userShotsToday.length,
    };
  });

  const order = { live: 0, personal: 1, break: 2, off: 3 };
  members.sort((a, b) => order[a.status] - order[b.status]);

  return Response.json({ members });
}
