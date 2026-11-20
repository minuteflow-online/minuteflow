import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-admin/submissions
 * The submission thread for every task this client has assigned (found by
 * joining through assigned_tasks.organization_id, not by VA — a task is
 * this client's regardless of who it's currently assigned to), newest
 * first. Read-only; review decisions go through the review route below.
 */
export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const admin = serviceClient();

  // assigned_task_assignees.va_id has no FK PostgREST can embed through to
  // profiles (it points at auth.users) — fetched and merged separately below.
  const { data: tasks, error: tasksError } = await admin
    .from("assigned_tasks")
    .select("id, task_name, task_detail, category, status, due_date, created_at, assigned_task_assignees(va_id, status)")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (tasksError) return Response.json({ error: tasksError.message }, { status: 500 });

  const taskIds = (tasks ?? []).map((t) => t.id as number);
  if (taskIds.length === 0) return Response.json({ tasks: [] });

  const assigneeIds = Array.from(
    new Set((tasks ?? []).flatMap((t) => (t.assigned_task_assignees ?? []).map((a) => a.va_id as string)))
  );
  const { data: assigneeProfiles } = assigneeIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", assigneeIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((assigneeProfiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  const { data: entries, error: entriesError } = await admin
    .from("task_submissions")
    .select("id, assigned_task_id, user_id, message_type, content, submission_link, created_at")
    .in("assigned_task_id", taskIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (entriesError) return Response.json({ error: entriesError.message }, { status: 500 });

  const entryUserIds = Array.from(new Set((entries ?? []).map((e) => e.user_id).filter(Boolean) as string[]));
  if (entryUserIds.length) {
    const { data: entryProfiles } = await admin.from("profiles").select("id, full_name").in("id", entryUserIds);
    for (const p of entryProfiles ?? []) nameById.set(p.id as string, p.full_name as string);
  }

  type EnrichedEntry = NonNullable<typeof entries>[number] & {
    profiles: { id: string; full_name: string } | null;
  };
  const entriesByTask = new Map<number, EnrichedEntry[]>();
  for (const e of entries ?? []) {
    const list = entriesByTask.get(e.assigned_task_id as number) ?? [];
    list.push({ ...e, profiles: e.user_id ? { id: e.user_id, full_name: nameById.get(e.user_id as string) ?? "Unknown" } : null });
    entriesByTask.set(e.assigned_task_id as number, list);
  }

  const result = (tasks ?? []).map((t) => ({
    id: t.id,
    task_name: t.task_name,
    task_detail: t.task_detail,
    category: t.category,
    status: t.status,
    due_date: t.due_date,
    assignees: (t.assigned_task_assignees ?? []).map((a) => ({
      va_id: a.va_id,
      status: a.status,
      profiles: { id: a.va_id, full_name: nameById.get(a.va_id as string) ?? "Unknown" },
    })),
    entries: entriesByTask.get(t.id as number) ?? [],
  }));

  return Response.json({ tasks: result });
}
