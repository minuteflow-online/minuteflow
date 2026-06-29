import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type AssignedTaskStatus =
  | "unassigned"
  | "pending"
  | "on_queue"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "revision_needed"
  | "approved"
  | "completed"
  | "paid"
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
  const { account, project, category, task_name, task_detail, task_notes, due_date, assigned_by, instructions, instructions_locked, review_required: putReviewRequired, recurring_template_id, va_ids } = body as {
    account?: string;
    project?: string;
    category?: string | null;
    task_name?: string;
    task_detail?: string;
    task_notes?: string;
    due_date?: string;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
    review_required?: boolean;
    recurring_template_id?: string | null;
    va_ids?: string[];
  };

  // Build update payload — only include defined fields
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (account !== undefined) updatePayload.account = account;
  if (project !== undefined) updatePayload.project = project;
  if (category !== undefined) updatePayload.category = category;
  if (task_name !== undefined) updatePayload.task_name = task_name.trim();
  if (task_detail !== undefined) updatePayload.task_detail = task_detail;
  if (task_notes !== undefined) updatePayload.task_notes = task_notes;
  if (due_date !== undefined) updatePayload.due_date = due_date;
  if (assigned_by !== undefined) updatePayload.assigned_by = assigned_by;
  if (instructions !== undefined) updatePayload.instructions = instructions;
  if (instructions_locked !== undefined) updatePayload.instructions_locked = Boolean(instructions_locked);
  if (putReviewRequired !== undefined) updatePayload.review_required = Boolean(putReviewRequired);
  if (recurring_template_id !== undefined) updatePayload.recurring_template_id = recurring_template_id;

  const { data: updatedTask, error: updateError } = await supabase
    .from("assigned_tasks")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateError)
    return Response.json({ error: updateError.message }, { status: 500 });

  // Sync task_detail → client_memo on linked time_logs
  if (task_detail !== undefined) {
    const { data: assigneeRows } = await supabase
      .from("assigned_task_assignees")
      .select("log_id")
      .eq("assigned_task_id", id);

    const logIds = (assigneeRows ?? [])
      .map((r: { log_id: number | null }) => r.log_id)
      .filter((lid): lid is number => typeof lid === "number");

    if (logIds.length > 0) {
      await supabase
        .from("time_logs")
        .update({ client_memo: task_detail || null })
        .in("id", logIds);
    }
  }

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

    // If the resulting assignee list is empty, mark the task itself as unassigned
    const remainingCount =
      (currentVaIds.filter((v) => incomingVaIds.includes(v)).length) + toInsert.length;
    if (remainingCount === 0) {
      await supabase
        .from("assigned_tasks")
        .update({ status: "unassigned", updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  }

  // Return updated task with current assignees
  const { data: finalAssignees, error: finalError } = await supabase
    .from("assigned_task_assignees")
    .select("id, va_id, status, log_id, notes, assigned_at, updated_at, instructions, instructions_locked")
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
 * Update an assignee row and/or task metadata.
 *
 * VA: must be assigned to the task. Can update their assignee row and archive their own assigned task.
 * Admin/manager: may target an assignee row with va_id; metadata-only updates do not require va_id.
 *
 * Body: { va_id?: string, status?: AssignedTaskStatus, log_id?: number, notes?: string, account?: string | null, project?: string | null, task_name?: string, task_detail?: string | null, task_notes?: string | null, due_date?: string | null }
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

  const isAdminOrManager = profile?.role === "admin" || profile?.role === "manager";
  const adminSupabase = createAdminClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { id } = await params;
  const body = await request.json();
  const {
    va_id: bodyVaId,
    status,
    log_id,
    notes,
    account,
    project,
    task_name,
    task_detail,
    task_notes,
    due_date,
    assigned_by,
    instructions,
    instructions_locked,
    archived_at,
    deleted_at,
    review_required,
  } = body as {
    va_id?: string;
    status?: AssignedTaskStatus;
    log_id?: number;
    notes?: string;
    account?: string | null;
    project?: string | null;
    task_name?: string;
    task_detail?: string | null;
    task_notes?: string | null;
    due_date?: string | null;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
    archived_at?: string | null;
    deleted_at?: string | null;
    review_required?: boolean;
  };

  // Use the service-role client here so VAs who are the task ASSIGNER (assigned_by)
  // can still be identified as the task owner. The RLS policy `assigned_tasks_va_read`
  // only permits VAs to read rows where they are an ASSIGNEE — so a VA who created
  // and assigned a task to someone else cannot read it via the session client, which
  // causes isTaskOwner to always be false even when the VA legitimately owns the task.
  const { data: taskContext, error: taskContextError } = await adminSupabase
    .from("assigned_tasks")
    .select("assigned_by")
    .eq("id", id)
    .single();

  if (taskContextError) {
    if (taskContextError.code === "PGRST116") {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    return Response.json({ error: taskContextError.message }, { status: 500 });
  }

  const isTaskOwner = taskContext?.assigned_by === user.id;

  const hasCoreMetadataUpdate =
    account !== undefined ||
    project !== undefined ||
    task_name !== undefined ||
    task_detail !== undefined ||
    task_notes !== undefined ||
    due_date !== undefined ||
    assigned_by !== undefined ||
    instructions !== undefined ||
    instructions_locked !== undefined;
  const hasMetadataUpdate =
    hasCoreMetadataUpdate || archived_at !== undefined || deleted_at !== undefined || review_required !== undefined;
  const hasArchiveUpdate = archived_at !== undefined;
  const hasDeleteUpdate = deleted_at !== undefined;
  const hasArchiveOnlyUpdate =
    hasArchiveUpdate &&
    !hasDeleteUpdate &&
    !hasCoreMetadataUpdate &&
    log_id === undefined &&
    notes === undefined &&
    status === undefined;
  const canUseTaskLevelStatusUpdate = isAdminOrManager || isTaskOwner;
  const hasTaskLevelStatusUpdate =
    status !== undefined &&
    canUseTaskLevelStatusUpdate &&
    bodyVaId === undefined &&
    log_id === undefined &&
    notes === undefined &&
    !hasMetadataUpdate;
  const hasAssigneeUpdate = log_id !== undefined || notes !== undefined || status !== undefined;

  const validStatuses: AssignedTaskStatus[] = [
    "unassigned",
    "pending",
    "on_queue",
    "in_progress",
    "submitted",
    "reviewing",
    "revision_needed",
    "approved",
    "completed",
    "paid",
    "cancelled",
  ];
  if (status !== undefined && !validStatuses.includes(status)) {
    return Response.json({ error: "Invalid status value" }, { status: 400 });
  }

  if (task_name !== undefined && task_name.trim().length === 0) {
    return Response.json({ error: "task_name cannot be empty" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // VA-only: allow checking review_required (true) but never unchecking (false).
  // This is handled as a standalone path — admin review_required changes go through the metadata path below.
  if (!isAdminOrManager && review_required !== undefined && !hasCoreMetadataUpdate && !hasAssigneeUpdate && archived_at === undefined && deleted_at === undefined) {
    if (review_required === false) {
      return Response.json({ error: "Forbidden: VAs cannot uncheck Review Required" }, { status: 403 });
    }
    // Verify the VA is an assignee on this task
    const { data: assigneeRow } = await supabase
      .from("assigned_task_assignees")
      .select("id")
      .eq("assigned_task_id", id)
      .eq("va_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!assigneeRow) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const { error: rrError } = await adminSupabase
      .from("assigned_tasks")
      .update({ review_required: true, updated_at: now })
      .eq("id", id);
    if (rrError) {
      return Response.json({ error: rrError.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  // Task owners (non-admin) may pass va_id to target a specific assignee row for
  // status-only updates (e.g., reviewing a submitted task). Block everything else.
  if (
    isTaskOwner &&
    !isAdminOrManager &&
    (hasCoreMetadataUpdate || log_id !== undefined || notes !== undefined || hasDeleteUpdate)
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isAdminOrManager && hasArchiveOnlyUpdate) {
    const { data: assignedTask, error: assignedTaskError } = await supabase
      .from("assigned_task_assignees")
      .select("id")
      .eq("assigned_task_id", id)
      .eq("va_id", user.id)
      .limit(1)
      .maybeSingle();

    if (assignedTaskError) {
      return Response.json({ error: assignedTaskError.message }, { status: 500 });
    }

    if (!assignedTask) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: archiveError } = await adminSupabase
      .from("assigned_tasks")
      .update({ archived_at, updated_at: now })
      .eq("id", id);

    if (archiveError) {
      return Response.json({ error: archiveError.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  if (!isAdminOrManager && hasMetadataUpdate) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isAdminOrManager && !isTaskOwner) {
    const { data: assignedTask, error: assignedTaskError } = await supabase
      .from("assigned_task_assignees")
      .select("id")
      .eq("assigned_task_id", id)
      .eq("va_id", user.id)
      .limit(1)
      .maybeSingle();

    if (assignedTaskError) {
      return Response.json({ error: assignedTaskError.message }, { status: 500 });
    }

    if (!assignedTask) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!hasAssigneeUpdate && !hasMetadataUpdate && !hasTaskLevelStatusUpdate) {
    return Response.json({ error: "At least one field is required" }, { status: 400 });
  }

  if (hasTaskLevelStatusUpdate) {
    const { data: taskForReview } = await adminSupabase
      .from("assigned_tasks")
      .select("review_required, status, revision_count")
      .eq("id", id)
      .single();

    if (!isAdminOrManager && status !== undefined && taskForReview?.review_required === true) {
      const allowedStatuses: AssignedTaskStatus[] = ["pending", "on_queue", "in_progress"];
      if (!allowedStatuses.includes(status)) {
        return Response.json({ error: "Forbidden: task requires review — VA can only set pending, on_queue, or in_progress" }, { status: 403 });
      }
    }

    const { error: taskStatusError } = await adminSupabase
      .from("assigned_tasks")
      .update({ status, updated_at: now })
      .eq("id", id);

    if (taskStatusError) {
      return Response.json({ error: taskStatusError.message }, { status: 500 });
    }

    if (status === "revision_needed") {
      // Decrement accuracy_score by 10 for every assignee on this task
      const { data: assigneeRows } = await adminSupabase
        .from("assigned_task_assignees")
        .select("id, accuracy_score")
        .eq("assigned_task_id", id);
      for (const row of assigneeRows ?? []) {
        await adminSupabase
          .from("assigned_task_assignees")
          .update({ status, accuracy_score: (row.accuracy_score as number) - 10, updated_at: now })
          .eq("id", row.id);
      }
    } else {
      const { error: assigneeStatusError } = await adminSupabase
        .from("assigned_task_assignees")
        .update({ status, updated_at: now })
        .eq("assigned_task_id", id);

      if (assigneeStatusError) {
        return Response.json({ error: assigneeStatusError.message }, { status: 500 });
      }
    }

    // Increment revision_count when moving out of revision_needed back to an active status
    const revisionAllowedStatuses: AssignedTaskStatus[] = ["pending", "on_queue", "in_progress"];
    if (taskForReview?.status === "revision_needed" && revisionAllowedStatuses.includes(status)) {
      await adminSupabase
        .from("assigned_tasks")
        .update({ revision_count: (taskForReview.revision_count ?? 0) + 1, updated_at: now })
        .eq("id", id);
    }

    return Response.json({ ok: true });
  }

  if (hasAssigneeUpdate) {
    let targetVaId: string;
    if (isAdminOrManager) {
      if (!bodyVaId) {
        return Response.json(
          { error: "va_id is required for admin/manager assignee updates" },
          { status: 400 }
        );
      }
      targetVaId = bodyVaId;
    } else if (isTaskOwner && bodyVaId) {
      // Non-admin task owner reviewing submitted work: allowed to target a specific
      // assignee row for status updates only (log_id/notes already blocked above).
      targetVaId = bodyVaId;
    } else {
      targetVaId = user.id;
    }

    const { data: taskForReview } = await adminSupabase
      .from("assigned_tasks")
      .select("review_required, status, revision_count")
      .eq("id", id)
      .single();

    if (!isAdminOrManager && status !== undefined && taskForReview?.review_required === true) {
      const allowedStatuses: AssignedTaskStatus[] = ["pending", "on_queue", "in_progress"];
      if (!allowedStatuses.includes(status)) {
        return Response.json({ error: "Forbidden: task requires review — VA can only set pending, on_queue, or in_progress" }, { status: 403 });
      }
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: now,
    };
    if (status !== undefined) updatePayload.status = status;
    if (log_id !== undefined) updatePayload.log_id = log_id;
    if (notes !== undefined) updatePayload.notes = notes;

    // When marking revision_needed, decrement accuracy_score by 10 on the targeted row
    if (status === "revision_needed") {
      const { data: currentAssigneeRow } = await adminSupabase
        .from("assigned_task_assignees")
        .select("accuracy_score")
        .eq("assigned_task_id", id)
        .eq("va_id", targetVaId)
        .single();
      if (currentAssigneeRow) {
        updatePayload.accuracy_score = (currentAssigneeRow.accuracy_score as number) - 10;
      }
    }

    // Task owners targeting another VA's row need the admin client to bypass RLS
    const assigneeClient = (isAdminOrManager || (isTaskOwner && bodyVaId)) ? adminSupabase : supabase;
    const { data: updatedAssignee, error: assigneeError } = await assigneeClient
      .from("assigned_task_assignees")
      .update(updatePayload)
      .eq("assigned_task_id", id)
      .eq("va_id", targetVaId)
      .select("id")
      .single();

    if (assigneeError) {
      if (assigneeError.code === "PGRST116") {
        return Response.json({ error: "Assignee row not found" }, { status: 404 });
      }
      return Response.json({ error: assigneeError.message }, { status: 500 });
    }

    if (!updatedAssignee) {
      return Response.json({ error: "Assignee row not found" }, { status: 404 });
    }

    // Increment revision_count when moving out of revision_needed back to an active status
    const revisionAllowedStatuses: AssignedTaskStatus[] = ["pending", "on_queue", "in_progress"];
    if (status !== undefined && taskForReview?.status === "revision_needed" && revisionAllowedStatuses.includes(status)) {
      await adminSupabase
        .from("assigned_tasks")
        .update({ revision_count: (taskForReview.revision_count ?? 0) + 1, updated_at: now })
        .eq("id", id);
    }

    if (status !== undefined && !isAdminOrManager) {
      const { error: syncError } = await adminSupabase
        .from("assigned_tasks")
        .update({ status, updated_at: now })
        .eq("id", id);

      if (syncError) {
        return Response.json({ error: syncError.message }, { status: 500 });
      }
    }
  }

  if (hasMetadataUpdate) {
    const updatePayload: Record<string, unknown> = { updated_at: now };
    if (account !== undefined) updatePayload.account = account;
    if (project !== undefined) updatePayload.project = project;
    if (task_name !== undefined) updatePayload.task_name = task_name.trim();
    if (task_detail !== undefined) updatePayload.task_detail = task_detail;
    if (task_notes !== undefined) updatePayload.task_notes = task_notes;
    if (due_date !== undefined) updatePayload.due_date = due_date;
    if (assigned_by !== undefined) updatePayload.assigned_by = assigned_by;
    if (instructions !== undefined) updatePayload.instructions = instructions;
    if (instructions_locked !== undefined) updatePayload.instructions_locked = Boolean(instructions_locked);
    if (archived_at !== undefined) updatePayload.archived_at = archived_at;
    if (deleted_at !== undefined) updatePayload.deleted_at = deleted_at;
    if (review_required !== undefined) updatePayload.review_required = Boolean(review_required);

    const { error: taskError } = await supabase
      .from("assigned_tasks")
      .update(updatePayload)
      .eq("id", id);

    if (taskError) {
      return Response.json({ error: taskError.message }, { status: 500 });
    }

    // Sync task_detail → client_memo on linked time_logs
    if (task_detail !== undefined) {
      const { data: assigneeRows } = await supabase
        .from("assigned_task_assignees")
        .select("log_id")
        .eq("assigned_task_id", id);

      const logIds = (assigneeRows ?? [])
        .map((r: { log_id: number | null }) => r.log_id)
        .filter((lid): lid is number => typeof lid === "number");

      if (logIds.length > 0) {
        await supabase
          .from("time_logs")
          .update({ client_memo: task_detail || null })
          .in("id", logIds);
      }
    }
  }

  return Response.json({ ok: true });
}

