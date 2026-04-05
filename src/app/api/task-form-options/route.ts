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
 * For VA users: tasks are filtered to only those in categories assigned to the VA
 * via va_category_assignments. Admins/managers see everything.
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

  // Check user role for VA filtering
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isVA = profile?.role === "va";

  // If VA, fetch their assigned category IDs + project/task visibility data
  let assignedCategoryIds: Set<number> | null = null;
  // Maps for project-level visibility: include set, exclude set
  let projectIncludes: Set<number> | null = null; // project IDs with 'include' assignments (any VA)
  let myProjectIncludes: Set<number> | null = null; // project IDs where THIS VA is included
  let myProjectExcludes: Set<number> | null = null; // project IDs where THIS VA is excluded
  // Maps for task-level visibility
  let taskIncludes: Set<number> | null = null; // project_task_assignment IDs with 'include' assignments (any VA)
  let myTaskIncludes: Set<number> | null = null; // task IDs where THIS VA is included
  let myTaskExcludes: Set<number> | null = null; // task IDs where THIS VA is excluded

  if (isVA) {
    const { data: vaCats } = await supabase
      .from("va_category_assignments")
      .select("category_id")
      .eq("va_id", user.id);
    if (vaCats && vaCats.length > 0) {
      assignedCategoryIds = new Set(vaCats.map((c) => c.category_id));
    }

    // Fetch ALL project assignments (to know which projects have any include assignments)
    const { data: allProjAssign } = await supabase
      .from("va_project_assignments")
      .select("va_id, project_tag_id, assignment_type");

    if (allProjAssign && allProjAssign.length > 0) {
      projectIncludes = new Set<number>();
      myProjectIncludes = new Set<number>();
      myProjectExcludes = new Set<number>();
      for (const a of allProjAssign) {
        if (a.assignment_type === "include") {
          projectIncludes.add(a.project_tag_id);
          if (a.va_id === user.id) myProjectIncludes.add(a.project_tag_id);
        }
        if (a.assignment_type === "exclude" && a.va_id === user.id) {
          myProjectExcludes.add(a.project_tag_id);
        }
      }
    }

    // Fetch ALL task assignments
    const { data: allTaskAssign } = await supabase
      .from("va_task_assignments")
      .select("va_id, project_task_assignment_id, assignment_type");

    if (allTaskAssign && allTaskAssign.length > 0) {
      taskIncludes = new Set<number>();
      myTaskIncludes = new Set<number>();
      myTaskExcludes = new Set<number>();
      for (const a of allTaskAssign) {
        if (a.assignment_type === "include") {
          taskIncludes.add(a.project_task_assignment_id);
          if (a.va_id === user.id) myTaskIncludes.add(a.project_task_assignment_id);
        }
        if (a.assignment_type === "exclude" && a.va_id === user.id) {
          myTaskExcludes.add(a.project_task_assignment_id);
        }
      }
    }
  }

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

  // 2. Filter projects by VA visibility, then get distinct accounts
  let visibleProjects = projects ?? [];
  if (isVA && (projectIncludes || myProjectExcludes)) {
    visibleProjects = visibleProjects.filter((p) => {
      // Rule 1: If project has include assignments, VA must be in the include list
      if (projectIncludes && projectIncludes.has(p.id)) {
        return myProjectIncludes ? myProjectIncludes.has(p.id) : false;
      }
      // Rule 2: If VA is excluded from this project, hide it
      if (myProjectExcludes && myProjectExcludes.has(p.id)) {
        return false;
      }
      // Rule 3: Default — visible to everyone
      return true;
    });
  }

  const accountSet = new Set<string>();
  for (const p of visibleProjects) {
    if (p.account) accountSet.add(p.account);
  }
  const accounts = Array.from(accountSet).sort();

  // 3. Fetch task assignments with task names + category_id for VA filtering
  const projectIds = visibleProjects.map((p) => p.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let assignments: any[] = [];

  if (projectIds.length > 0) {
    const { data: assignData, error: assignError } = await supabase
      .from("project_task_assignments")
      .select(
        "id, task_library_id, project_tag_id, sort_order, billing_type, task_rate, task_library(id, task_name, is_active, category_id, billing_type, default_rate)"
      )
      .in("project_tag_id", projectIds)
      .order("sort_order");

    if (assignError) {
      return Response.json({ error: assignError.message }, { status: 500 });
    }
    assignments = assignData ?? [];
  }

  // 4. Build tasks grouped by project_tag_id (only active tasks, filtered by VA assignments)
  const tasksByProject: Record<
    number,
    Array<{
      id: number;
      task_library_id: number;
      task_name: string;
      billing_type: string;
      task_rate: number | null;
    }>
  > = {};

  for (const a of assignments) {
    // Supabase join can return object or array — normalize
    const lib = Array.isArray(a.task_library) ? a.task_library[0] : a.task_library;
    if (!lib || !lib.is_active) continue;

    // VA filtering: category-based
    if (assignedCategoryIds && lib.category_id && !assignedCategoryIds.has(lib.category_id)) {
      continue;
    }

    // VA filtering: task-level include/exclude
    if (isVA && (taskIncludes || myTaskExcludes)) {
      // Rule 1: If task has include assignments, VA must be in the include list
      if (taskIncludes && taskIncludes.has(a.id)) {
        if (!myTaskIncludes || !myTaskIncludes.has(a.id)) continue;
      }
      // Rule 2: If VA is excluded from this task, hide it
      else if (myTaskExcludes && myTaskExcludes.has(a.id)) {
        continue;
      }
      // Rule 3: Default — visible to everyone
    }

    if (!tasksByProject[a.project_tag_id]) {
      tasksByProject[a.project_tag_id] = [];
    }

    // Effective billing: assignment-level overrides task-level
    const effectiveBilling = a.billing_type ?? lib.billing_type ?? "hourly";
    const effectiveRate = a.task_rate ?? lib.default_rate ?? null;

    tasksByProject[a.project_tag_id].push({
      id: a.id,
      task_library_id: a.task_library_id,
      task_name: lib.task_name,
      billing_type: effectiveBilling,
      task_rate: effectiveRate,
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
    projects: visibleProjects,
    tasksByProject,
    clientMap,
  });
}
