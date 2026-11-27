import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/client-admin/tasks/:id  body: { review_required: boolean }
 * A client may change Review Required on their own org's tasks at any time,
 * even once it's locked — the same power the Founder has company-wide,
 * scoped to tasks whose organization_id is theirs. Changing it records the
 * answer as locked, same as staff answering it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) return Response.json({ error: "Invalid task id" }, { status: 400 });

  const { review_required } = ((await request.json().catch(() => null)) ?? {}) as { review_required?: unknown };
  if (typeof review_required !== "boolean") {
    return Response.json({ error: "review_required (true | false) is required" }, { status: 400 });
  }

  const admin = serviceClient();
  const { data: updated, error } = await admin
    .from("assigned_tasks")
    .update({ review_required, review_required_locked: true, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("organization_id", organizationId)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!updated?.length) return Response.json({ error: "That task isn't yours." }, { status: 403 });
  return Response.json({ success: true });
}
