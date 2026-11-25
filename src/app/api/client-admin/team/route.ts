import { requireClientOrgVaIds, serviceClient, isResponse } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * The client's own Team page.
 *
 * GET    → the people who run the org (owner + co-admins, pending co-admin
 *          invites) and its VAs with work details only — never phone,
 *          address, birthday, emergency contact or payment accounts.
 * PATCH  { vaId, role: "va" | "manager" } → change a VA's org role. Their
 *          company-wide role (profiles.role) is never touched.
 * DELETE { vaId } → take a VA off this org's team. Their account and their
 *          agency work are untouched; the client just loses access to them.
 */

const VA_WORK_COLUMNS =
  "id, full_name, username, avatar_url, position, department, work_days, shift_start, shift_end, shift_hours";

export async function GET() {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, ownerId, isOwner, userId } = auth;

  const admin = serviceClient();
  const now = new Date().toISOString();
  const [{ data: memberRows }, { data: clientUsers }, { data: adminInvites }] = await Promise.all([
    admin
      .from("organization_members")
      .select("va_id, status, role, joined_at, created_at")
      .eq("organization_id", organizationId),
    admin
      .from("profiles")
      .select("id, full_name, username, avatar_url, is_active")
      .eq("role", "client")
      .eq("organization_id", organizationId),
    admin
      .from("invitations")
      .select("id, email, created_at, expires_at")
      .eq("organization_id", organizationId)
      .eq("org_role", "admin")
      .is("used_at", null)
      .gt("expires_at", now),
  ]);

  // Work details only for VAs who accepted. Until then the client has typed
  // an email and nothing more — they see that email back, never the VA's
  // name, photo, position or schedule (the invite is the VA's to accept).
  const activeIds = (memberRows ?? []).filter((m) => m.status === "active").map((m) => m.va_id as string);
  const invitedIds = (memberRows ?? []).filter((m) => m.status !== "active").map((m) => m.va_id as string);
  const { data: vaProfiles } = activeIds.length
    ? await admin.from("profiles").select(VA_WORK_COLUMNS).in("id", activeIds)
    : { data: [] as Record<string, unknown>[] };
  const profileById = new Map((vaProfiles ?? []).map((p) => [p.id as string, p]));
  const invitedEmail = new Map<string, string>();
  await Promise.all(
    invitedIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) invitedEmail.set(id, data.user.email);
    })
  );

  const vas = (memberRows ?? [])
    .map((m) => {
      const p = profileById.get(m.va_id as string) as Record<string, unknown> | undefined;
      return {
        id: m.va_id as string,
        status: m.status as "invited" | "active",
        orgRole: (m.role as "va" | "manager") ?? "va",
        joinedAt: (m.joined_at as string | null) ?? null,
        invitedAt: m.created_at as string,
        fullName: (p?.full_name as string | null) ?? invitedEmail.get(m.va_id as string) ?? "Invited VA",
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        position: (p?.position as string | null) ?? null,
        department: (p?.department as string | null) ?? null,
        workDays: (p?.work_days as number[] | null) ?? null,
        shiftStart: (p?.shift_start as string | null) ?? null,
        shiftEnd: (p?.shift_end as string | null) ?? null,
        shiftHours: (p?.shift_hours as number | null) ?? null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  // The owner is whoever organizations.owner_profile_id names — list them
  // even if their own profile points somewhere else.
  const people = [...(clientUsers ?? [])];
  if (ownerId && !people.some((p) => p.id === ownerId)) {
    const { data: owner } = await admin
      .from("profiles")
      .select("id, full_name, username, avatar_url, is_active")
      .eq("id", ownerId)
      .maybeSingle();
    if (owner) people.push(owner);
  }

  const admins = people
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      id: p.id as string,
      fullName: (p.full_name as string | null) || (p.username as string | null) || "Unknown",
      avatarUrl: (p.avatar_url as string | null) ?? null,
      orgRole: p.id === ownerId ? ("owner" as const) : ("admin" as const),
    }))
    .sort((a, b) => (a.orgRole === "owner" ? -1 : b.orgRole === "owner" ? 1 : a.fullName.localeCompare(b.fullName)));

  return Response.json({
    viewerId: userId,
    viewerIsOwner: isOwner,
    admins,
    pendingAdminInvites: adminInvites ?? [],
    vas,
  });
}

async function readBody(request: Request) {
  return ((await request.json().catch(() => null)) ?? {}) as { vaId?: unknown; role?: unknown };
}

export async function PATCH(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId, vaIds } = auth;

  const { vaId, role } = await readBody(request);
  if (typeof vaId !== "string" || (role !== "va" && role !== "manager")) {
    return Response.json({ error: "vaId and role (va | manager) are required" }, { status: 400 });
  }
  if (!vaIds.includes(vaId)) {
    return Response.json({ error: "That VA isn't on your team." }, { status: 403 });
  }

  const admin = serviceClient();
  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("va_id", vaId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}

export async function DELETE(request: Request) {
  const auth = await requireClientOrgVaIds();
  if (isResponse(auth)) return auth;
  const { organizationId } = auth;

  const { vaId } = await readBody(request);
  if (typeof vaId !== "string") {
    return Response.json({ error: "vaId is required" }, { status: 400 });
  }

  // Active or still-invited — either way, only a row in this org.
  const admin = serviceClient();
  const { data: removed, error } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", organizationId)
    .eq("va_id", vaId)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed || removed.length === 0) {
    return Response.json({ error: "That VA isn't on your team." }, { status: 404 });
  }

  const unassigned = await unassignOpenOrgTasks(admin, organizationId, vaId);
  return Response.json({
    success: true,
    unassignedTasks: unassigned,
    message:
      unassigned > 0
        ? `Removed from your team and taken off ${unassigned} open task${unassigned === 1 ? "" : "s"}. ${unassigned === 1 ? "It shows" : "They show"} as Unassigned in the Tasks tab.`
        : "Removed from your team.",
  });
}

/** Work that's finished stays on the record; anything else is still open. */
const FINISHED_STATUSES = new Set(["approved", "completed", "paid", "cancelled"]);

/**
 * Once a VA is off a client's team, the client can no longer see their work —
 * so they mustn't keep holding that client's open tasks either (they could
 * still start and submit them, unseen). Take them off every open task this
 * org owns; finished work keeps its assignee for the record. A task left with
 * nobody on it goes back to "on_queue" so the client can reassign it.
 * Agency tasks and other clients' tasks are never touched.
 */
async function unassignOpenOrgTasks(
  admin: ReturnType<typeof serviceClient>,
  organizationId: string,
  vaId: string
): Promise<number> {
  const { data: orgTasks } = await admin
    .from("assigned_tasks")
    .select("id, status, assigned_task_assignees(id, va_id, status)")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  let count = 0;
  for (const task of orgTasks ?? []) {
    const assignees = (task.assigned_task_assignees ?? []) as Array<{ id: number; va_id: string | null; status: string | null }>;
    const mine = assignees.filter((a) => a.va_id === vaId && !FINISHED_STATUSES.has(a.status ?? ""));
    if (mine.length === 0) continue;

    const { error } = await admin
      .from("assigned_task_assignees")
      .delete()
      .in("id", mine.map((a) => a.id));
    if (error) continue;
    count++;

    const remaining = assignees.filter((a) => !mine.some((m) => m.id === a.id));
    if (remaining.length === 0 && !FINISHED_STATUSES.has((task.status as string | null) ?? "")) {
      await admin
        .from("assigned_tasks")
        .update({ status: "on_queue", updated_at: new Date().toISOString() })
        .eq("id", task.id as number)
        .eq("organization_id", organizationId);
    }
  }
  return count;
}
