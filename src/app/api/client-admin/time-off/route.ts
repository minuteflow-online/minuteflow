import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/time-off
 * Approved time off for the client's own active VAs, for the Calendar — the
 * dates and times only. The request's subject, message and notes are the
 * VA's business with the agency and never come back here.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  if (auth.vaIds.length === 0) return Response.json({ requests: [] });

  const { data, error } = await serviceClient()
    .from("va_requests")
    .select("user_id, type, status, start_date, end_date, start_time, end_time")
    .in("user_id", auth.vaIds)
    .eq("type", "time_off")
    .eq("status", "approved")
    .not("start_date", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ requests: data ?? [] });
}
