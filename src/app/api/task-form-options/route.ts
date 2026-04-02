import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/task-form-options
 *
 * Returns all data needed for the cascading task form:
 * - accounts (distinct from project_tags)
 * - projects grouped by account (from project_tags)
 * - tasks grouped by project_tag_id (from project_task_assignments + task_library)
 * - account-client mappings
 *
 * Optional query params:
 *   ?account=X   — filter projects/tasks to one account
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterAccount = searchParams.get("account");

  // 1. Fetch active projects (with account info)
  let projectQuery = supabase
    .from("project_tags")
    .select("id, account, project_name, sort_order")
    .eq("is_active", true)
    .order("account")
    .order("sort_order");

  if (filterAccount) {
    projectQuery = projectQuery.eq("account", filterAccount);
  }

  const { data: projects, error: projError } = await projectQuery;

  if (projError) {
    return Response.json({ error: projError.message }, { status: 500 });
  }

  // 2. Get distinct accounts from projects
  const accountSet = new Set<string>();
  for (const p of projects ?? []) {
    if (p.account) accountSet.add(p.account);
  }
  const accounts = Array.from(accountSet).sort();

  // 3. Fetch task assignments with task names
  const projectIds = (projects ?? []).map((p) => p.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let assignments: any[] = [];

  if (projectIds.length > 0) {
    const { data: assignData, error: assignError } = await supabase
      .from("project_task_assignments")
      .select(
        "id, task_library_id, project_tag_id, sort_order, task_library(id, task_name, is_active)"
      )
      .in("project_tag_id", projectIds)
      .order("sort_order");

    if (assignError) {
      return Response.json({ error: assignError.message }, { status: 500 });
    }
    assignments = assignData ?? [];
  }

  // 4. Build tasks grouped by project_tag_id (only active tasks)
  const tasksByProject: Record<
    number,
    Array<{ id: number; task_library_id: number; task_name: string }>
  > = {};

  for (const a of assignments) {
    // Supabase join can return object or array — normalize
    const lib = Array.isArray(a.task_library) ? a.task_library[0] : a.task_library;
    if (!lib || !lib.is_active) continue;

    if (!tasksByProject[a.project_tag_id]) {
      tasksByProject[a.project_tag_id] = [];
    }
    tasksByProject[a.project_tag_id].push({
      id: a.id,
      task_library_id: a.task_library_id,
      task_name: lib.task_name,
    });
  }

  // 5. Fetch account-client mappings
  let clientMap: Record<string, string> = {};
  try {
    const [accRes, mappingRes] = await Promise.all([
      supabase.from("accounts").select("id, name").eq("active", true),
      supabase
        .from("account_client_map")
        .select("account_id, clients(name)")
    ]);

    if (accRes.data && mappingRes.data) {
      const accById: Record<number, string> = {};
      for (const acc of accRes.data) {
        accById[acc.id] = acc.name;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const m of mappingRes.data as any[]) {
        const accName = accById[m.account_id];
        // Supabase join can return object or array — normalize
        const clientObj = Array.isArray(m.clients) ? m.clients[0] : m.clients;
        if (accName && clientObj?.name) {
          clientMap[accName] = clientObj.name;
        }
      }
    }
  } catch {
    // Client mapping is non-critical — continue without it
    clientMap = {};
  }

  return Response.json({
    accounts,
    projects: projects ?? [],
    tasksByProject,
    clientMap,
  });
}
