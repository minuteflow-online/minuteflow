import { requireClientOrgVaIds, serviceClient, isResponse, orgVisibleShots } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/screenshots?va=<id>&limit=<n>
 * Screen captures of work done for this client's org, newest first — never
 * a VA's agency or other-client work, and never anyone outside the org,
 * regardless of the `va` filter passed.
 */
export async function GET(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { vaIds, organizationId } = auth;

  if (vaIds.length === 0) return Response.json({ screenshots: [] });

  const { searchParams } = new URL(request.url);
  const va = searchParams.get("va");
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 300);

  const admin = serviceClient();
  // Over-fetch, then keep only org work: a shared VA's newest captures may
  // well be for someone else.
  const { data, error } = await admin
    .from("task_screenshots")
    .select("id, user_id, drive_file_id, created_at, failure_reason, log_id, submission_id")
    .in("user_id", va && vaIds.includes(va) ? [va] : vaIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit * 5, 1000));
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const visible = (await orgVisibleShots(admin, organizationId, data ?? [])).slice(0, limit);

  const userIds = Array.from(new Set(visible.map((s) => s.user_id as string)));
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  const screenshots = visible.map((s) => ({
    id: s.id,
    vaId: s.user_id,
    vaName: nameById.get(s.user_id as string) ?? "Unknown",
    url: s.drive_file_id ? `/api/drive-image?id=${s.drive_file_id}` : null,
    createdAt: s.created_at,
    failureReason: s.failure_reason,
  }));

  return Response.json({ screenshots });
}
