import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * POST /api/client-admin/capture-now
 * body: { targetUserId: string }
 * Same request admin's Capture Now button makes (an insert into
 * capture_requests the desktop app polls) — only ever for a VA active in
 * the caller's own org, checked server-side regardless of what id is sent.
 */
export async function POST(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { userId, vaIds } = auth;

  const { targetUserId } = (await request.json()) as { targetUserId?: string };
  if (!targetUserId || !vaIds.includes(targetUserId)) {
    return Response.json({ error: "That VA isn't on your team." }, { status: 403 });
  }

  const admin = serviceClient();
  const { error } = await admin.from("capture_requests").insert({
    target_user_id: targetUserId,
    requested_by: userId,
    status: "pending",
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
