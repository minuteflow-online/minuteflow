import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET: List fixed-rate project_task_assignments that have NO va_task_assignment yet.
 * These are "claimable" tasks for VAs.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all project_task_assignments that are fixed billing
  // We need to find ones where billing_type = 'fixed' at either the
  // project_task_assignment level OR the task_library level
  const { data: allPTAs, error: ptaError } = await supabase
    .from("project_task_assignments")
    .select(
      "id, task_library_id, project_tag_id, billing_type, task_rate, task_library(id, task_name, is_active, billing_type, default_rate), project_tags(id, account, project_name, is_active)"
    )
    .order("id");

  if (ptaError) {
    return Response.json({ error: ptaError.message }, { status: 500 });
  }

  // Filter to only fixed-rate tasks (check PTA billing_type first, fall back to task_library)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fixedPTAs = (allPTAs ?? []).filter((pta: any) => {
    const effectiveBilling = pta.billing_type ?? pta.task_library?.billing_type;
    return effectiveBilling === "fixed" && pta.task_library?.is_active !== false && pta.project_tags?.is_active !== false;
  });

  if (fixedPTAs.length === 0) {
    return Response.json({ claimable: [] });
  }

  // Get all va_task_assignments for these PTAs to find which ones are already claimed
  const ptaIds = fixedPTAs.map((p: { id: number }) => p.id);
  const { data: existingVTAs } = await supabase
    .from("va_task_assignments")
    .select("project_task_assignment_id, va_id")
    .in("project_task_assignment_id", ptaIds)
    .eq("assignment_type", "include");

  // Build a set of PTA IDs that already have VA assignments
  const claimedPTAIds = new Set(
    (existingVTAs ?? []).map((v: { project_task_assignment_id: number }) => v.project_task_assignment_id)
  );

  // Return only unclaimed PTAs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimable = fixedPTAs.filter((p: any) => !claimedPTAIds.has(p.id));

  return Response.json({ claimable });
}

/**
 * POST: VA claims a task (self-assigns)
 * Body: { project_task_assignment_id }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { project_task_assignment_id } = body;

  if (!project_task_assignment_id) {
    return Response.json({ error: "project_task_assignment_id is required" }, { status: 400 });
  }

  // Verify the PTA exists and is fixed billing
  const { data: pta } = await supabase
    .from("project_task_assignments")
    .select("id, billing_type, task_rate, task_library(id, task_name, billing_type, default_rate)")
    .eq("id", project_task_assignment_id)
    .single();

  if (!pta) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ptaAny = pta as any;
  const effectiveBilling = ptaAny.billing_type ?? ptaAny.task_library?.billing_type;
  if (effectiveBilling !== "fixed") {
    return Response.json({ error: "Only fixed-rate tasks can be claimed" }, { status: 400 });
  }

  // Check if already claimed by anyone
  const { data: existing } = await supabase
    .from("va_task_assignments")
    .select("id, va_id")
    .eq("project_task_assignment_id", project_task_assignment_id)
    .eq("assignment_type", "include");

  if (existing && existing.length > 0) {
    return Response.json({ error: "This task has already been claimed" }, { status: 409 });
  }

  // Determine rate
  const effectiveRate = ptaAny.task_rate ?? ptaAny.task_library?.default_rate ?? null;

  // Create the VA task assignment (claim)
  const { data: assignment, error } = await supabase
    .from("va_task_assignments")
    .insert({
      va_id: user.id,
      project_task_assignment_id,
      billing_type: "fixed",
      rate: effectiveRate,
      assignment_type: "include",
      assigned_by: user.id, // self-assigned
      status: "not_started",
    })
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, status, profiles!va_task_assignments_va_id_fkey(id, full_name, username), project_task_assignments(id, task_library(id, task_name), project_tags(id, account, project_name))"
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ assignment }, { status: 201 });
}
