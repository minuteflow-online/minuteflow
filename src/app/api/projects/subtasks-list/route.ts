import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * GET /api/projects/subtasks-list?projectIds=a,b,c
 * The (non-cancelled) subtasks for the given objectives, for the dashboard's
 * Subtasks checkbox card. Returns { subtasks: [{ id, project_id, task_name,
 * status }] }. Ticking a box is done via PATCH /api/assigned-tasks/[id].
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ subtasks: [] });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("assigned_tasks")
    .select("id, project_id, task_name, status, recurring_template_id, due_date, start_date, account, review_required, assigned_task_assignees(va_id)")
    .in("project_id", ids)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type Row = {
    id: number; project_id: string; task_name: string; status: string; recurring_template_id: string | null; due_date: string | null; start_date: string | null; account: string | null; review_required: boolean | null;
    assigned_task_assignees?: Array<{ va_id: string }> | null;
  };
  const allRows = (data ?? []) as Row[];

  // Collapse each recurring series to a single row — the earliest not-yet-done
  // occurrence — so a template's pre-generated window doesn't pile up as
  // repeated-looking entries. Non-recurring tasks pass through untouched.
  // (Mirrors collapseRecurringSeries in src/lib/taskSchedule.ts.)
  const SERIES_DONE = new Set(["completed", "paid", "cancelled"]);
  const rows: Row[] = (() => {
    const groups = new Map<string, Row[]>();
    const out: Row[] = [];
    for (const t of allRows) {
      if (!t.recurring_template_id) { out.push(t); continue; }
      const key = String(t.recurring_template_id);
      const g = groups.get(key);
      if (g) g.push(t); else groups.set(key, [t]);
    }
    for (const g of groups.values()) {
      if (g.length === 1) { out.push(g[0]); continue; }
      const sorted = [...g].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
      const notDone = sorted.filter((t) => !SERIES_DONE.has(t.status));
      out.push(notDone[0] ?? sorted[sorted.length - 1]);
    }
    return out;
  })();

  // Resolve assignee profiles in one lookup — there is no direct PostgREST
  // relationship from assigned_task_assignees to profiles, so va_id is mapped
  // separately (same pattern the assigned-tasks route uses).
  const vaIds = Array.from(new Set(rows.flatMap((t) => (t.assigned_task_assignees ?? []).map((a) => a.va_id)).filter(Boolean)));
  const profileMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
  if (vaIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", vaIds);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, { id: p.id as string, name: (p.full_name as string) || (p.username as string) || "?", avatar_url: (p.avatar_url as string | null) ?? null });
    }
  }

  // Resolve each account name → its client name (accounts → account_client_map
  // → clients). These lookup tables are tiny, so fetch them whole and map in
  // memory rather than joining per row.
  const clientByAccount = new Map<string, string>();
  {
    const [{ data: accs }, { data: maps }, { data: clis }] = await Promise.all([
      supabase.from("accounts").select("id, name"),
      supabase.from("account_client_map").select("account_id, client_id"),
      supabase.from("clients").select("id, name"),
    ]);
    const accById = new Map<number, string>((accs ?? []).map((a) => [a.id as number, a.name as string]));
    const cliById = new Map<number, string>((clis ?? []).map((c) => [c.id as number, c.name as string]));
    for (const m of maps ?? []) {
      const accName = accById.get(m.account_id as number);
      const cliName = cliById.get(m.client_id as number);
      if (accName && cliName) clientByAccount.set(accName, cliName);
    }
  }

  const subtasks = rows.map((t) => ({
    id: t.id,
    project_id: t.project_id,
    task_name: t.task_name,
    status: t.status,
    recurring: Boolean(t.recurring_template_id),
    due_date: t.due_date ?? null,
    start_date: t.start_date ?? null,
    account: t.account ?? null,
    client: t.account ? (clientByAccount.get(t.account) ?? null) : null,
    review_required: t.review_required ?? null,
    assignees: (t.assigned_task_assignees ?? []).map((a) => profileMap.get(a.va_id)).filter((p): p is NonNullable<typeof p> => Boolean(p)),
  }));

  return Response.json({ subtasks });
}
