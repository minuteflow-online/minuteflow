import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/tasks
 * Every task this client's org assigned (assigned_tasks.organization_id),
 * newest first, with who it's assigned to — for the client's Tasks tab.
 * Never a task the org doesn't own.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const admin = serviceClient();
  const { data, error } = await admin
    .from("assigned_tasks")
    .select(
      "id, task_name, category, status, due_date, start_date, planned_minutes, review_required, review_required_locked, created_at, archived_at, deleted_at, assigned_task_assignees(va_id, status)"
    )
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const vaIds = Array.from(
    new Set(
      (data ?? []).flatMap((t) =>
        ((t.assigned_task_assignees ?? []) as Array<{ va_id: string | null }>).map((a) => a.va_id).filter(Boolean)
      )
    )
  ) as string[];
  const { data: people } = vaIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", vaIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name || "Unknown"]));

  const tasks = (data ?? []).map((t) => {
    const assignees = (t.assigned_task_assignees ?? []) as Array<{ va_id: string | null; status: string | null }>;
    return {
      id: t.id as number,
      taskName: t.task_name as string,
      category: (t.category as string | null) ?? null,
      status: (assignees[0]?.status as string | null) ?? (t.status as string | null) ?? null,
      dueDate: (t.due_date as string | null) ?? null,
      plannedMinutes: (t.planned_minutes as number | null) ?? null,
      reviewRequired: Boolean(t.review_required),
      archived: Boolean(t.archived_at),
      assignees: assignees.map((a) => (a.va_id ? nameById.get(a.va_id) ?? "Unknown" : "Unassigned")),
    };
  });

  return Response.json({ tasks });
}
