import { requireClientOrgVaIds, serviceClient, isResponse, isWorkingForOrg } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * POST /api/client-admin/force-clock-out
 * body: { targetUserId: string }
 * Same effect as admin's Force Clock Out — closes any open time log and
 * clears the session — only ever for a VA active in the caller's own org,
 * and only while they are working on one of this org's tasks.
 * auto_closed_reason is "client" rather than "admin" so anything reading
 * that field later can tell who ended the session.
 */
export async function POST(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds, organizationId } = auth;

  const { targetUserId } = (await request.json()) as { targetUserId?: string };
  if (!targetUserId || !vaIds.includes(targetUserId)) {
    return Response.json({ error: "That VA isn't on your team." }, { status: 403 });
  }

  const admin = serviceClient();
  // Only while the VA is on this org's own task — never their agency or
  // another client's work.
  if (!(await isWorkingForOrg(admin, organizationId, targetUserId))) {
    return Response.json(
      { error: "You can only clock someone out while they're working on one of your tasks." },
      { status: 409 }
    );
  }
  const now = new Date().toISOString();
  const nowMs = new Date(now).getTime();

  const { data: openLogs } = await admin
    .from("time_logs")
    .select("id, start_time")
    .eq("user_id", targetUserId)
    .is("end_time", null)
    .neq("category", "Clock Out");

  if (openLogs?.length) {
    const results = await Promise.all(
      openLogs.map((log) => {
        const startMs = log.start_time ? new Date(log.start_time as string).getTime() : nowMs;
        const duration_ms = Math.max(0, nowMs - startMs);
        return admin.from("time_logs").update({ end_time: now, duration_ms }).eq("id", log.id);
      })
    );
    const closeError = results.find((r) => r.error)?.error;
    if (closeError) {
      return Response.json(
        { error: `Couldn't force clock-out: failed to close an active task (${closeError.message}). Nothing was changed.` },
        { status: 500 }
      );
    }
  }

  const { error: sessionError } = await admin
    .from("sessions")
    .update({
      clocked_in: false,
      active_task: null,
      updated_at: now,
      clock_out_time: now,
      auto_closed_reason: "client",
    })
    .eq("user_id", targetUserId);

  if (sessionError) return Response.json({ error: sessionError.message }, { status: 500 });
  return Response.json({ success: true });
}
