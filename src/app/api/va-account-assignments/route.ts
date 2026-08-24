import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * The accounts for a VA come from two places, per the agreed model: rows in
 * va_account_assignments (assigned directly by an admin, and the only ones that
 * can carry a budget), plus accounts implied by existing project assignments.
 * Implied ones come back as inherited:true so the UI can mark them and offer to
 * make them direct.
 */

type AccountRow = { id: number; name: string };

/**
 * A to-one embed comes back as an object at runtime, but the generated types
 * describe it as an array. Normalize both shapes to a single row or null.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadCaller(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  return { user, isAdmin: hasBroadAdminAccess(profile) };
}

/** GET ?va_id= — the accounts for that VA, with their budgets and assignments. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { user, isAdmin } = await loadCaller(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const vaId = new URL(request.url).searchParams.get("va_id") || user.id;
  // A VA may read their own; anything else needs admin.
  if (vaId !== user.id && !isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [directRes, accountsRes, projectAssignRes] = await Promise.all([
    supabase
      .from("va_account_assignments")
      .select("id, account_id, weekly_hours_budget, monthly_hours_budget, assignments, assigned_at")
      .eq("va_id", vaId),
    supabase.from("accounts").select("id, name").order("name"),
    supabase
      .from("va_project_assignments")
      .select("project_tag_id, project_tags(account, project_name)")
      .eq("va_id", vaId),
  ]);

  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const byName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  // Accounts implied by project assignments, plus the projects implying them.
  const inherited = new Map<number, string[]>();
  type ProjectTagEmbed = { account: string | null; project_name: string | null };
  for (const row of (projectAssignRes.data ?? []) as unknown as {
    project_tags: ProjectTagEmbed | ProjectTagEmbed[] | null;
  }[]) {
    const tag = one(row.project_tags);
    const acc = tag?.account ? byName.get(tag.account.trim().toLowerCase()) : undefined;
    if (!acc) continue;
    if (!inherited.has(acc.id)) inherited.set(acc.id, []);
    if (tag?.project_name) inherited.get(acc.id)!.push(tag.project_name);
  }

  const direct = (directRes.data ?? []) as {
    id: number;
    account_id: number;
    weekly_hours_budget: number | null;
    monthly_hours_budget: number | null;
    assignments: string | null;
  }[];
  const directIds = new Set(direct.map((d) => d.account_id));

  const rows = [
    ...direct.map((d) => ({
      assignmentId: d.id as number | null,
      accountId: d.account_id,
      accountName: byId.get(d.account_id)?.name ?? "Unknown account",
      inherited: false,
      viaProjects: inherited.get(d.account_id) ?? [],
      weekly_hours_budget: d.weekly_hours_budget,
      monthly_hours_budget: d.monthly_hours_budget,
      assignments: d.assignments,
    })),
    ...Array.from(inherited.entries())
      .filter(([accountId]) => !directIds.has(accountId))
      .map(([accountId, projects]) => ({
        assignmentId: null as number | null,
        accountId,
        accountName: byId.get(accountId)?.name ?? "Unknown account",
        inherited: true,
        viaProjects: projects,
        // Only a direct assignment can hold a budget.
        weekly_hours_budget: null as number | null,
        monthly_hours_budget: null as number | null,
        assignments: null as string | null,
      })),
  ].sort((a, b) => a.accountName.localeCompare(b.accountName));

  return Response.json({ assignments: rows, allAccounts: accounts });
}

/** POST { va_id, account_id } — link an account to a VA. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { user, isAdmin } = await loadCaller(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { va_id, account_id } = await request.json();
  if (!va_id || !account_id) {
    return Response.json({ error: "va_id and account_id are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("va_account_assignments")
    .insert({ va_id, account_id, assigned_by: user.id })
    .select()
    .single();

  // Already linked — treat as success so a double click is not an error.
  if (error && !error.message.includes("duplicate")) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ assignment: data ?? null }, { status: 201 });
}

/** PATCH { id, weekly_hours_budget?, monthly_hours_budget? } — set the budget. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { user, isAdmin } = await loadCaller(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id, weekly_hours_budget, monthly_hours_budget, assignments } = await request.json();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (weekly_hours_budget !== undefined) updates.weekly_hours_budget = weekly_hours_budget;
  if (monthly_hours_budget !== undefined) updates.monthly_hours_budget = monthly_hours_budget;
  if (assignments !== undefined) updates.assignments = assignments || null;

  const { error } = await supabase.from("va_account_assignments").update(updates).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}

/** DELETE ?id= — unlink an account from a VA. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { user, isAdmin } = await loadCaller(supabase);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("va_account_assignments").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
