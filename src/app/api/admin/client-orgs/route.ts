import { createClient } from "@/lib/supabase/server";
import { serviceClient, unassignOpenOrgTasks } from "@/lib/clientAdminAccess";
import { hasAdminPanelAccess, hasFinancialAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * Admin → Client Accounts: the agency's view of its MinuteFlow client
 * companies (organizations). Client work stays out of the everyday agency
 * lists; this is where Toni and the admins assigned to a client look at it
 * when they want to — the agency still pays those VAs (Toni, 2026-11-26).
 *
 * Who sees what: the Founder tier (hasFinancialAccess) sees every client and
 * decides who's assigned; any other admin-panel user sees only the clients
 * assigned to them (organization_agency_admins).
 */

type Caller = { userId: string; seesAll: boolean };

async function requireAgencyAdmin(): Promise<Caller | Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role, department").eq("id", user.id).single();
  if (!hasAdminPanelAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return { userId: user.id, seesAll: hasFinancialAccess(profile) };
}

async function visibleOrgIds(admin: ReturnType<typeof serviceClient>, caller: Caller): Promise<string[] | null> {
  if (caller.seesAll) return null; // null = every org
  const { data } = await admin.from("organization_agency_admins").select("organization_id").eq("admin_id", caller.userId);
  return (data ?? []).map((r) => r.organization_id as string);
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function hoursByOrg(admin: ReturnType<typeof serviceClient>, orgIds: string[], sinceIso: string) {
  const totals: Record<string, number> = {};
  if (orgIds.length === 0) return totals;
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("time_logs")
      .select("organization_id, duration_ms")
      .in("organization_id", orgIds)
      .gte("start_time", sinceIso)
      .is("deleted_at", null)
      .order("id")
      .range(from, from + 999);
    for (const l of data ?? []) {
      const org = l.organization_id as string;
      totals[org] = (totals[org] ?? 0) + ((l.duration_ms as number) || 0);
    }
    if (!data || data.length < 1000) break;
  }
  return totals;
}

export async function GET(request: Request) {
  const caller = await requireAgencyAdmin();
  if (caller instanceof Response) return caller;
  const admin = serviceClient();
  const allowed = await visibleOrgIds(admin, caller);
  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    if (allowed && !allowed.includes(id)) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await orgDetail(admin, id));
  }

  let orgQuery = admin.from("organizations").select("id, name, owner_profile_id, created_at").order("name");
  if (allowed) {
    if (allowed.length === 0) return Response.json({ orgs: [], seesAll: caller.seesAll, assignable: [] });
    orgQuery = orgQuery.in("id", allowed);
  }
  const { data: orgs, error } = await orgQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const orgIds = (orgs ?? []).map((o) => o.id as string);

  const [{ data: members }, { data: clientProfiles }, { data: assignments }, hours] = await Promise.all([
    orgIds.length
      ? admin.from("organization_members").select("organization_id, status").in("organization_id", orgIds)
      : Promise.resolve({ data: [] as Array<{ organization_id: string; status: string }> }),
    orgIds.length
      ? admin.from("profiles").select("id, full_name, organization_id, is_active").eq("role", "client").in("organization_id", orgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; organization_id: string; is_active: boolean }> }),
    orgIds.length
      ? admin.from("organization_agency_admins").select("organization_id, admin_id").in("organization_id", orgIds)
      : Promise.resolve({ data: [] as Array<{ organization_id: string; admin_id: string }> }),
    hoursByOrg(admin, orgIds, monthStartIso()),
  ]);

  const ownerIds = (orgs ?? []).map((o) => o.owner_profile_id as string | null).filter((v): v is string => Boolean(v));
  const adminIds = (assignments ?? []).map((a) => a.admin_id as string);
  const { data: names } = ownerIds.length + adminIds.length
    ? await admin.from("profiles").select("id, full_name, username").in("id", [...new Set([...ownerIds, ...adminIds])])
    : { data: [] as Array<{ id: string; full_name: string | null; username: string | null }> };
  const nameOf = new Map((names ?? []).map((p) => [p.id as string, (p.full_name as string | null) || (p.username as string | null) || "Unknown"]));

  // Who the Founder can assign: everyone with admin-panel access (not clients).
  let assignable: Array<{ id: string; name: string }> = [];
  if (caller.seesAll) {
    const { data: staff } = await admin
      .from("profiles")
      .select("id, full_name, username, role, department, is_active")
      .in("role", ["admin", "manager", "specialist", "founder", "ceo"])
      .eq("is_active", true);
    assignable = (staff ?? [])
      .filter((p) => hasAdminPanelAccess(p))
      .map((p) => ({ id: p.id as string, name: (p.full_name as string | null) || (p.username as string | null) || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return Response.json({
    seesAll: caller.seesAll,
    assignable,
    orgs: (orgs ?? []).map((o) => {
      const oid = o.id as string;
      const m = (members ?? []).filter((r) => r.organization_id === oid);
      return {
        id: oid,
        name: o.name as string,
        ownerName: o.owner_profile_id ? nameOf.get(o.owner_profile_id as string) ?? "Unknown" : "—",
        createdAt: o.created_at as string,
        coAdmins: (clientProfiles ?? []).filter((p) => p.organization_id === oid && p.id !== o.owner_profile_id && p.is_active !== false).length,
        activeVas: m.filter((r) => r.status === "active").length,
        invitedVas: m.filter((r) => r.status !== "active").length,
        hoursThisMonthMs: hours[oid] ?? 0,
        assignedAdmins: (assignments ?? [])
          .filter((a) => a.organization_id === oid)
          .map((a) => ({ id: a.admin_id as string, name: nameOf.get(a.admin_id as string) ?? "Unknown" })),
      };
    }),
  });
}

async function orgDetail(admin: ReturnType<typeof serviceClient>, orgId: string) {
  const { data: org } = await admin.from("organizations").select("id, name, owner_profile_id, created_at").eq("id", orgId).maybeSingle();
  if (!org) return { error: "Not found" };

  const [{ data: clients }, { data: members }, { data: tasks }, hours] = await Promise.all([
    admin.from("profiles").select("id, full_name, username, is_active").eq("role", "client").eq("organization_id", orgId),
    admin.from("organization_members").select("va_id, status, role, joined_at, created_at").eq("organization_id", orgId),
    admin
      .from("assigned_tasks")
      .select("id, task_name, status, due_date, created_at, archived_at, assigned_task_assignees(va_id, status)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    hoursByOrg(admin, [orgId], monthStartIso()),
  ]);

  const peopleIds = new Set<string>();
  if (org.owner_profile_id) peopleIds.add(org.owner_profile_id as string);
  for (const m of members ?? []) peopleIds.add(m.va_id as string);
  for (const t of tasks ?? []) for (const a of (t.assigned_task_assignees ?? []) as Array<{ va_id: string | null }>) if (a.va_id) peopleIds.add(a.va_id);
  const { data: people } = peopleIds.size
    ? await admin.from("profiles").select("id, full_name, username").in("id", [...peopleIds])
    : { data: [] as Array<{ id: string; full_name: string | null; username: string | null }> };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) || (p.username as string | null) || "Unknown"]));

  // This month's client-work hours per VA — what the agency pays them for.
  const { data: logs } = await admin
    .from("time_logs")
    .select("user_id, duration_ms")
    .eq("organization_id", orgId)
    .gte("start_time", monthStartIso())
    .is("deleted_at", null);
  const hoursByVa: Record<string, number> = {};
  for (const l of logs ?? []) hoursByVa[l.user_id as string] = (hoursByVa[l.user_id as string] ?? 0) + ((l.duration_ms as number) || 0);

  const owner = (clients ?? []).find((c) => c.id === org.owner_profile_id);
  return {
    org: { id: org.id, name: org.name, createdAt: org.created_at, hoursThisMonthMs: hours[orgId] ?? 0 },
    owner: org.owner_profile_id ? { id: org.owner_profile_id, name: nameOf.get(org.owner_profile_id as string) ?? "Unknown", active: owner?.is_active !== false } : null,
    coAdmins: (clients ?? [])
      .filter((c) => c.id !== org.owner_profile_id)
      .map((c) => ({ id: c.id as string, name: (c.full_name as string | null) || (c.username as string | null) || "Unknown", active: c.is_active !== false })),
    vas: (members ?? []).map((m) => ({
      id: m.va_id as string,
      name: nameOf.get(m.va_id as string) ?? "Unknown",
      status: m.status as string,
      orgRole: (m.role as string | null) ?? "va",
      since: (m.joined_at as string | null) ?? (m.created_at as string),
      hoursThisMonthMs: hoursByVa[m.va_id as string] ?? 0,
    })),
    tasks: (tasks ?? []).map((t) => ({
      id: t.id as number,
      name: t.task_name as string,
      status: t.status as string,
      dueDate: (t.due_date as string | null) ?? null,
      archived: Boolean(t.archived_at),
      assignees: ((t.assigned_task_assignees ?? []) as Array<{ va_id: string | null; status: string | null }>)
        .filter((a) => a.va_id)
        .map((a) => ({ name: nameOf.get(a.va_id as string) ?? "Unknown", status: a.status })),
    })),
  };
}

/** PATCH { orgId, adminIds } — Founder tier only: who's assigned to this client. */
export async function PATCH(request: Request) {
  const caller = await requireAgencyAdmin();
  if (caller instanceof Response) return caller;
  if (!caller.seesAll) return Response.json({ error: "Only the Founder can assign admins to a client." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { orgId?: unknown; adminIds?: unknown } | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const adminIds = Array.isArray(body?.adminIds) ? (body!.adminIds as unknown[]).filter((x): x is string => typeof x === "string") : null;
  if (!orgId || !adminIds) return Response.json({ error: "orgId and adminIds are required" }, { status: 400 });

  const admin = serviceClient();
  // Only real admin-panel staff can be assigned — never a VA or a client.
  const { data: staff } = adminIds.length
    ? await admin.from("profiles").select("id, role, department").in("id", adminIds)
    : { data: [] as Array<{ id: string; role: string | null; department: string | null }> };
  const valid = (staff ?? []).filter((p) => hasAdminPanelAccess(p)).map((p) => p.id as string);
  if (valid.length !== new Set(adminIds).size) return Response.json({ error: "Only admins can be assigned." }, { status: 400 });

  const { error: delError } = await admin.from("organization_agency_admins").delete().eq("organization_id", orgId);
  if (delError) return Response.json({ error: delError.message }, { status: 500 });
  if (valid.length) {
    const { error } = await admin
      .from("organization_agency_admins")
      .insert(valid.map((id) => ({ organization_id: orgId, admin_id: id, assigned_by: caller.userId })));
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}

/**
 * POST { action, orgId, vaId } — fix-it tools on a client the caller can see.
 *   add_va    → put one of our VAs on this client's team right away (the
 *               agency assigning them — Toni: VAs are both invited by the
 *               client and assigned by us).
 *   remove_va → take a VA off this client's team; they also come off the
 *               client's unfinished tasks, same as when the client removes them.
 */
export async function POST(request: Request) {
  const caller = await requireAgencyAdmin();
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as { action?: unknown; orgId?: unknown; vaId?: unknown } | null;
  const action = body?.action;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const vaId = typeof body?.vaId === "string" ? body.vaId : "";
  if (!orgId || !vaId || (action !== "add_va" && action !== "remove_va")) {
    return Response.json({ error: "action (add_va | remove_va), orgId and vaId are required" }, { status: 400 });
  }

  const admin = serviceClient();
  const allowed = await visibleOrgIds(admin, caller);
  if (allowed && !allowed.includes(orgId)) return Response.json({ error: "Not found" }, { status: 404 });

  if (action === "add_va") {
    const { data: va } = await admin.from("profiles").select("role, is_active").eq("id", vaId).maybeSingle();
    if (!va || va.role !== "va" || va.is_active === false) {
      return Response.json({ error: "Only an active VA can be added to a client's team." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { data: existing } = await admin
      .from("organization_members")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("va_id", vaId)
      .maybeSingle();
    const { error } = existing
      ? await admin.from("organization_members").update({ status: "active", joined_at: now }).eq("id", existing.id)
      : await admin
          .from("organization_members")
          .insert({ organization_id: orgId, va_id: vaId, status: "active", invited_by: caller.userId, joined_at: now });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, message: "Added to the client's team." });
  }

  const { data: removed, error } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("va_id", vaId)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed?.length) return Response.json({ error: "That VA isn't on this client's team." }, { status: 404 });
  const unassigned = await unassignOpenOrgTasks(admin, orgId, vaId);
  return Response.json({
    success: true,
    message: unassigned > 0 ? `Removed, and taken off ${unassigned} open task${unassigned === 1 ? "" : "s"}.` : "Removed from the client's team.",
  });
}
