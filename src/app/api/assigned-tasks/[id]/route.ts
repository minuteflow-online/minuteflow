import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AssignedTaskStatus =
  | "pending"
  | "on_queue"
  | "in_progress"
  | "completed"
  | "cancelled";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/assigned-tasks/[id]
 * Admin/manager only.
 * Body: { account?, project?, task_name?, task_detail?, due_date?, va_ids?: string[] }
 * If va_ids provided: removes assignees no longer in the list, inserts new ones.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Confirm the task exists
  const { data: existing, error: fetchError } = await supabase
    .from("assigned_tasks")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await request.json();
  const { account, project, task_name, task_detail, task_notes, due_date, va_ids } = body as {
    account?: string;
    project?: string;
    task_name?: string;
    task_detail?: string;
    task_notes?: string;
    due_date?: string;
    va_ids?: string[];
  };

  // Build update payload — only include defined fields
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (account !== undefined) updatePayload.account = account;
  if (project !== undefined) updatePayload.project = project;
  if (task_name !== undefined) updatePayload.task_name = task_name.trim();
  if (task_detail !== undefined) updatePayload.task_detail = task_detail;
  if (task_notes !== undefined) updatePayload.task_notes = task_notes;
  if (due_date !== undefined) updatePayload.due_date = due_date;

  const { data: updatedTask, error: updateError } = await supabase
    .from("assigned_tasks")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateError)
    return Response.json({ error: updateError.message }, { status: 500 });

  // Handle va_ids reconciliation if provided
  if (Array.isArray(va_ids)) {
    // Fetch current assignees
    const { data: currentAssignees, error: currentError } = await supabase
      .from("assigned_task_assignees")
      .select("id, va_id")
      .eq("assigned_task_id", id);

    if (currentError)
      return Response.json({ error: currentError.message }, { status: 500 });

    const currentVaIds = (currentAssignees ?? []).map((a) => a.va_id as string);
    const incomingVaIds = va_ids;

    // Delete assignees that are no longer in the new list
    const toDelete = (currentAssignees ?? [])
      .filter((a) => !incomingVaIds.includes(a.va_id as string))
      .map((a) => a.id as string);

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("assigned_task_assignees")
        .delete()
        .in("id", toDelete);

      if (deleteError)
        return Response.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new assignees not already present
    const toInsert = incomingVaIds.filter(
      (va_id) => !currentVaIds.includes(va_id)
    );

    if (toInsert.length > 0) {
      const newRows = toInsert.map((va_id) => ({
        assigned_task_id: id,
        va_id,
        status: "pending" as AssignedTaskStatus,
      }));

      const { error: insertError } = await supabase
        .from("assigned_task_assignees")
        .insert(newRows);

      if (insertError)
        return Response.json({ error: insertError.message }, { status: 500 });
    }
  }

  // Return updated task with current assignees
  const { data: finalAssignees, error: finalError } = await supabase
    .from("assigned_task_assignees")
    .select("id, va_id, status, log_id, notes, assigned_at, updated_at")
    .eq("assigned_task_id", id);

  if (finalError)
    return Response.json({ error: finalError.message }, { status: 500 });

  return Response.json({
    task: { ...updatedTask, assigned_task_assignees: finalAssignees ?? [] },
  });
}

/**
 * DELETE /api/assigned-tasks/[id]
 * Admin/manager only. Cascade deletes assignees via DB constraint.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await supabase
    .from("assigned_tasks")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return new Response(null, { status: 204 });
}

/**
 * PATCH /api/assigned-tasks/[id]
 * Update status of an assignee row.
 *
 * VA: updates their own row (va_id = auth.uid()).
 * Admin/manager: must supply body.va_id to specify which assignee to update.
 *
 * Body: { va_id?: string, status: AssignedTaskStatus, log_id?: number, notes?: string }
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  const body = await request.json();
  const { va_id: bodyVaId, status, log_id, notes } = body as {
    va_id?: string;
    status: AssignedTaskStatus;
    log_id?: number;
    notes?: string;
  };

  if (!status) {
    return Response.json({ error: "status is required" }, { status: 400 });
  }

  const validStatuses: AssignedTaskStatus[] = [
    "pending",
    "on_queue",
    "in_progress",
    "completed",
    "cancelled",
  ];
  if (!validStatuses.includes(status)) {
    return Response.json({ error: "Invalid status value" }, { status: 400 });
  }

  const isAdminOrManager =
    profile?.role === "admin" || profile?.role === "manager";

  // Determine which va_id to target
  let targetVaId: string;
  if (isAdminOrManager) {
    if (!bodyVaId) {
      return Response.json(
        { error: "va_id is required for admin/manager PATCH" },
        { status: 400 }
      );
    }
    targetVaId = bodyVaId;
  } else {
    // VA can only update their own assignee row
    targetVaId = user.id;
  }

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (log_id !== undefined) updatePayload.log_id = log_id;
  if (notes !== undefined) updatePayload.notes = notes;

  const { data: updated, error } = await supabase
    .from("assigned_task_assignees")
    .update(updatePayload)
    .eq("assigned_task_id", id)
    .eq("va_id", targetVaId)
    .select()
    .single();

  if (error) {
    // PGRST116 = no rows matched
    if (error.code === "PGRST116") {
      return Response.json({ error: "Assignee row not found" }, { status: 404 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ assignee: updated });
}
