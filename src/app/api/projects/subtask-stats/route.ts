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

// Statuses counted as "done" — mirrors DONE_STATUSES in VAProjectsTab.
const DONE = new Set(["completed", "approved", "paid"]);

/**
 * GET /api/projects/subtask-stats?projectIds=a,b,c
 * Returns { stats: { [projectId]: { total, done } } } for the given objectives/
 * operations — total is non-cancelled subtasks, done is completed/approved/paid.
 * Caller passes the ids it can already see (from the projects list), so no RLS
 * fan-out is needed here.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const idsParam = new URL(request.url).searchParams.get("projectIds") ?? "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ stats: {} });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("assigned_tasks")
    .select("project_id, status")
    .in("project_id", ids)
    .is("deleted_at", null)
    .is("archived_at", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const stats: Record<string, { total: number; done: number }> = {};
  for (const id of ids) stats[id] = { total: 0, done: 0 };
  for (const row of data ?? []) {
    const pid = row.project_id as string | null;
    if (!pid || !stats[pid]) continue;
    if (row.status === "cancelled") continue;
    stats[pid].total += 1;
    if (DONE.has(row.status as string)) stats[pid].done += 1;
  }

  return Response.json({ stats });
}
