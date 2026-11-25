import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function serviceClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Every client-admin route's entry gate: confirms the caller is a client
 * with an org, and returns the active VA ids in that org. Every query or
 * action downstream scopes to exactly this list — a client never reaches a
 * VA who isn't theirs, no matter what id a request names.
 */
export async function requireClientOrgVaIds(): Promise<
  | {
      userId: string;
      organizationId: string;
      vaIds: string[];
      /** The org's owner (the client who signed up and created it). */
      ownerId: string | null;
      /** Whether the caller is that owner rather than a co-admin. */
      isOwner: boolean;
    }
  | Response
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client" || !profile.organization_id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = serviceClient();
  const [{ data: members }, { data: org }] = await Promise.all([
    admin
      .from("organization_members")
      .select("va_id")
      .eq("organization_id", profile.organization_id)
      .eq("status", "active"),
    admin.from("organizations").select("owner_profile_id").eq("id", profile.organization_id).maybeSingle(),
  ]);

  const vaIds = (members ?? []).map((m) => m.va_id as string);
  const ownerId = (org?.owner_profile_id as string | null) ?? null;
  return { userId: user.id, organizationId: profile.organization_id, vaIds, ownerId, isOwner: ownerId === user.id };
}

export function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

type AdminClient = ReturnType<typeof serviceClient>;

/**
 * Being in a client's org does NOT open up a VA's whole history to that
 * client — most of their time is usually agency work, or another client's.
 * A client only ever sees work done *for their org*: a time log tagged with
 * their organization_id, or tied to (or submitted on) an assigned task their
 * org owns. These helpers are that one rule, shared by every client route.
 */

/** Of these assigned task ids, the ones that belong to this org. */
export async function orgOwnedTaskIds(
  admin: AdminClient,
  organizationId: string,
  taskIds: number[]
): Promise<Set<number>> {
  const owned = new Set<number>();
  const unique = Array.from(new Set(taskIds));
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await admin
      .from("assigned_tasks")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", unique.slice(i, i + 200));
    for (const row of data ?? []) owned.add(row.id as number);
  }
  return owned;
}

/** Of these time log ids, the ones that were work for this org. */
export async function orgOwnedLogIds(
  admin: AdminClient,
  organizationId: string,
  logIds: number[]
): Promise<Set<number>> {
  const unique = Array.from(new Set(logIds));
  const logs: Array<{ id: number; organization_id: string | null; assigned_task_id: number | null }> = [];
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await admin
      .from("time_logs")
      .select("id, organization_id, assigned_task_id")
      .in("id", unique.slice(i, i + 200));
    logs.push(...((data ?? []) as typeof logs));
  }
  const tasks = await orgOwnedTaskIds(
    admin,
    organizationId,
    logs.map((l) => l.assigned_task_id).filter((v): v is number => v != null)
  );
  return new Set(
    logs
      .filter((l) => l.organization_id === organizationId || (l.assigned_task_id != null && tasks.has(l.assigned_task_id)))
      .map((l) => l.id)
  );
}

/**
 * Of these screenshots, the ones this org's client may see: taken by an
 * active member of the org, during a log that was org work or as part of a
 * submission on one of the org's tasks.
 */
export async function orgVisibleShots<
  T extends { user_id: string | null; log_id: number | null; submission_id?: number | null }
>(admin: AdminClient, organizationId: string, shots: T[]): Promise<T[]> {
  if (shots.length === 0) return [];
  const shooterIds = Array.from(new Set(shots.map((s) => s.user_id).filter((v): v is string => Boolean(v))));
  const { data: members } = shooterIds.length
    ? await admin
        .from("organization_members")
        .select("va_id")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .in("va_id", shooterIds)
    : { data: [] as Array<{ va_id: string }> };
  const memberIds = new Set((members ?? []).map((m) => m.va_id as string));

  const candidates = shots.filter((s) => s.user_id && memberIds.has(s.user_id));
  const okLogs = await orgOwnedLogIds(
    admin,
    organizationId,
    candidates.map((s) => s.log_id).filter((v): v is number => v != null)
  );

  const submissionIds = Array.from(
    new Set(candidates.map((s) => s.submission_id).filter((v): v is number => v != null))
  );
  const submissionTask = new Map<number, number>();
  for (let i = 0; i < submissionIds.length; i += 200) {
    const { data } = await admin
      .from("task_submissions")
      .select("id, assigned_task_id")
      .in("id", submissionIds.slice(i, i + 200));
    for (const row of data ?? []) {
      if (row.assigned_task_id != null) submissionTask.set(row.id as number, row.assigned_task_id as number);
    }
  }
  const okTasks = await orgOwnedTaskIds(admin, organizationId, Array.from(submissionTask.values()));

  return candidates.filter(
    (s) =>
      (s.log_id != null && okLogs.has(s.log_id)) ||
      (s.submission_id != null && okTasks.has(submissionTask.get(s.submission_id) ?? -1))
  );
}

/**
 * Whether this VA's current active task is work for this org — the gate on
 * a client's Capture Now and Force Clock Out, so a client can never grab a
 * screen or end a shift while the VA is working for someone else.
 */
export async function isWorkingForOrg(
  admin: AdminClient,
  organizationId: string,
  vaId: string
): Promise<boolean> {
  const { data: session } = await admin
    .from("sessions")
    .select("clocked_in, active_task")
    .eq("user_id", vaId)
    .maybeSingle();
  const logId = Number((session?.active_task as { logId?: unknown } | null)?.logId);
  if (!session?.clocked_in || !Number.isFinite(logId)) return false;
  const owned = await orgOwnedLogIds(admin, organizationId, [logId]);
  return owned.has(logId);
}

/**
 * Whether a client (employer) login's own org owns this assigned task — the
 * gate that lets a client into a task's attachments and to-dos without ever
 * reaching an agency task or another client's.
 */
export async function clientOwnsTask(userId: string, taskId: string | number): Promise<boolean> {
  const admin = serviceClient();
  const [{ data: me }, { data: task }] = await Promise.all([
    admin.from("profiles").select("organization_id").eq("id", userId).maybeSingle(),
    admin.from("assigned_tasks").select("organization_id").eq("id", taskId).maybeSingle(),
  ]);
  return Boolean(me?.organization_id && task?.organization_id === me.organization_id);
}

/**
 * Where a VA's work comes from. `clientOnly` is a VA who joined MinuteFlow
 * through a client's VA invite (an invitations row with organization_id set
 * and no org_role) — they work for that client, not the agency, so agency-only
 * spaces (the open task pools, the General board) are not theirs. A VA who was
 * already agency staff and later joined a client team is NOT client-only.
 * `orgIds` are the client orgs the VA is an active member of. The database
 * mirrors this rule in is_client_only_va() for the RLS policies.
 */
export async function vaWorkScope(
  admin: AdminClient,
  userId: string
): Promise<{ clientOnly: boolean; orgIds: string[] }> {
  const [{ data: profile }, { data: invite }, { data: memberships }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
    admin
      .from("invitations")
      .select("id")
      .eq("used_by", userId)
      .not("organization_id", "is", null)
      .is("org_role", null)
      .limit(1)
      .maybeSingle(),
    admin.from("organization_members").select("organization_id").eq("va_id", userId).eq("status", "active"),
  ]);
  return {
    clientOnly: profile?.role === "va" && Boolean(invite),
    orgIds: (memberships ?? []).map((m) => m.organization_id as string),
  };
}
