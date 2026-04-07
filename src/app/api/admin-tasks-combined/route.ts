import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET: Combined view of ALL tasks for admin Task Management table.
 * Returns both:
 *   1. VA-assigned tasks (from va_task_assignments with assignment_type='include')
 *   2. Unassigned tasks (from project_task_assignments with NO va_task_assignment)
 *
 * Unassigned tasks are returned in the same shape as assigned ones,
 * with va_id=null and profiles=null so the UI can show "Unassigned".
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Get all VA-assigned tasks (same as existing va-task-assignments endpoint)
  const { data: assigned, error: assignedError } = await supabase
    .from("va_task_assignments")
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, assignment_type, assigned_by, assigned_at, status, instructions, profiles!va_task_assignments_va_id_fkey(id, full_name, username, position), project_task_assignments(id, task_library_id, project_tag_id, billing_type, task_rate, task_library(id, task_name), project_tags(id, account, project_name))"
    )
    .eq("assignment_type", "include")
    .order("assigned_at", { ascending: false });

  if (assignedError) {
    return Response.json({ error: assignedError.message }, { status: 500 });
  }

  // 2. Get ALL project_task_assignments
  const { data: allPTAs, error: ptaError } = await supabase
    .from("project_task_assignments")
    .select(
      "id, task_library_id, project_tag_id, billing_type, task_rate, instructions, task_library(id, task_name, is_active, billing_type, default_rate), project_tags(id, account, project_name, is_active)"
    )
    .order("id");

  if (ptaError) {
    return Response.json({ error: ptaError.message }, { status: 500 });
  }

  // 3. Find which PTAs already have VA assignments
  const assignedPTAIds = new Set(
    (assigned ?? []).map((a: { project_task_assignment_id: number }) => a.project_task_assignment_id)
  );

  // 4. Build "unassigned" rows from PTAs that have no VA assignment
  // Filter to active tasks only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unassigned = (allPTAs ?? [])
    .filter((pta: any) => {
      // Skip if already assigned to a VA
      if (assignedPTAIds.has(pta.id)) return false;
      // Skip inactive tasks/projects
      if (pta.task_library?.is_active === false) return false;
      if (pta.project_tags?.is_active === false) return false;
      // Only include fixed-rate unassigned tasks (hourly unassigned belong in Available Tasks)
      const billing = pta.billing_type ?? pta.task_library?.billing_type ?? "fixed";
      if (billing === "hourly") return false;
      return true;
    })
    .map((pta: any) => {
      const effectiveBilling = pta.billing_type ?? pta.task_library?.billing_type ?? "fixed";
      const effectiveRate = pta.task_rate ?? pta.task_library?.default_rate ?? null;
      return {
        // Use negative PTA id to avoid collision with va_task_assignment IDs
        id: -pta.id,
        va_id: null,
        project_task_assignment_id: pta.id,
        billing_type: effectiveBilling,
        rate: effectiveRate,
        assignment_type: "include",
        assigned_by: null,
        assigned_at: null,
        status: "unassigned" as const,
        instructions: pta.instructions ?? null,
        profiles: null,
        project_task_assignments: {
          id: pta.id,
          task_library_id: pta.task_library_id,
          project_tag_id: pta.project_tag_id,
          billing_type: pta.billing_type,
          task_rate: pta.task_rate,
          task_library: pta.task_library
            ? { id: pta.task_library.id, task_name: pta.task_library.task_name }
            : null,
          project_tags: pta.project_tags
            ? { id: pta.project_tags.id, account: pta.project_tags.account, project_name: pta.project_tags.project_name }
            : null,
        },
        _isUnassigned: true,
      };
    });

  // 5. Combine: assigned first, then unassigned
  const combined = [...(assigned ?? []), ...unassigned];

  return Response.json({ assignments: combined });
}
