import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET: List fixed-rate project_task_assignments that still have remaining slots.
 * Includes quantity, claimed_slots, and remaining_slots per task.
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
  const { data: allPTAs, error: ptaError } = await supabase
    .from("project_task_assignments")
    .select(
      "id, task_library_id, project_tag_id, billing_type, task_rate, instructions, quantity, task_library(id, task_name, is_active, billing_type, default_rate), project_tags(id, account, project_name, is_active)"
    )
    .order("id");

  if (ptaError) {
    return Response.json({ error: ptaError.message }, { status: 500 });
  }

  // Filter to only fixed-rate active tasks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fixedPTAs = (allPTAs ?? []).filter((pta: any) => {
    const effectiveBilling = pta.billing_type ?? pta.task_library?.billing_type;
    return effectiveBilling === "fixed" && pta.task_library?.is_active !== false && pta.project_tags?.is_active !== false;
  });

  if (fixedPTAs.length === 0) {
    return Response.json({ claimable: [] });
  }

  // Get all va_task_assignments for these PTAs to compute claimed slots
  const ptaIds = fixedPTAs.map((p: { id: number }) => p.id);
  const { data: existingVTAs } = await supabase
    .from("va_task_assignments")
    .select("project_task_assignment_id, va_id, quantity_claimed")
    .in("project_task_assignment_id", ptaIds)
    .eq("assignment_type", "include");

  // Build a map: PTA ID → { total_claimed, already_claimed_by_me }
  const claimedMap = new Map<number, { total: number; byMe: boolean }>();
  for (const v of (existingVTAs ?? [])) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qty = (v as any).quantity_claimed ?? 1;
    const ptaId = v.project_task_assignment_id;
    const existing = claimedMap.get(ptaId) ?? { total: 0, byMe: false };
    claimedMap.set(ptaId, {
      total: existing.total + qty,
      byMe: existing.byMe || v.va_id === user.id,
    });
  }

  // Build claimable list: tasks with remaining slots that this VA hasn't already claimed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimable = fixedPTAs
    .map((p: any) => {
      const claimed = claimedMap.get(p.id) ?? { total: 0, byMe: false };
      const totalQty = p.quantity ?? 1;
      const remaining = totalQty - claimed.total;
      return {
        ...p,
        quantity: totalQty,
        claimed_slots: claimed.total,
        remaining_slots: remaining,
        already_claimed_by_me: claimed.byMe,
      };
    })
    .filter((p: any) => p.remaining_slots > 0 && !p.already_claimed_by_me);

  return Response.json({ claimable });
}

/**
 * POST: VA claims a task (self-assigns), optionally claiming multiple slots.
 * Body: { project_task_assignment_id, quantity_claimed? }
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
  const { project_task_assignment_id, quantity_claimed = 1 } = body;

  if (!project_task_assignment_id) {
    return Response.json({ error: "project_task_assignment_id is required" }, { status: 400 });
  }

  const qtyClaimed = Math.max(1, Math.floor(Number(quantity_claimed) || 1));

  // Verify the PTA exists and is fixed billing
  const { data: pta } = await supabase
    .from("project_task_assignments")
    .select("id, billing_type, task_rate, instructions, quantity, task_library(id, task_name, billing_type, default_rate)")
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

  // Check existing claims for this PTA
  const { data: existing } = await supabase
    .from("va_task_assignments")
    .select("id, va_id, quantity_claimed")
    .eq("project_task_assignment_id", project_task_assignment_id)
    .eq("assignment_type", "include");

  // Check if this VA already claimed this task
  const alreadyClaimed = (existing ?? []).find((v) => v.va_id === user.id);
  if (alreadyClaimed) {
    return Response.json({ error: "You have already claimed this task" }, { status: 409 });
  }

  // Check remaining slots
  const totalQty = ptaAny.quantity ?? 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalClaimed = (existing ?? []).reduce((sum, v) => sum + ((v as any).quantity_claimed ?? 1), 0);
  const remaining = totalQty - totalClaimed;

  if (qtyClaimed > remaining) {
    return Response.json({ error: `Only ${remaining} slot(s) remaining for this task` }, { status: 409 });
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
      assigned_by: user.id,
      status: "not_started",
      instructions: ptaAny?.instructions || null,
      quantity_claimed: qtyClaimed,
    })
    .select(
      "id, va_id, project_task_assignment_id, billing_type, rate, status, quantity_claimed, profiles!va_task_assignments_va_id_fkey(id, full_name, username), project_task_assignments(id, task_library(id, task_name), project_tags(id, account, project_name))"
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  // Auto-include project so the account/project shows in the VA's Log a Task dropdown
  try {
    const { data: ptaForProject } = await supabase
      .from("project_task_assignments")
      .select("project_tag_id")
      .eq("id", project_task_assignment_id)
      .single();
    if (ptaForProject?.project_tag_id) {
      await supabase
        .from("va_project_assignments")
        .upsert(
          {
            va_id: user.id,
            project_tag_id: ptaForProject.project_tag_id,
            billing_type: "fixed",
            assignment_type: "include",
            assigned_by: user.id,
          },
          { onConflict: "va_id,project_tag_id", ignoreDuplicates: true }
        );
    }
  } catch {
    // Non-critical — claim still succeeded
    console.error("Auto-project-include on claim failed (non-critical)");
  }

  return Response.json({ assignment }, { status: 201 });
}
