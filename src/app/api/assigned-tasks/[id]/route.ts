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
  const { account, project, task_name, task_detail, task_notes, due_date, assigned_by, instructions, instructions_locked, va_ids } = body as {
    account?: string;
    project?: string;
    task_name?: string;
    task_detail?: string;
    task_notes?: string;
    due_date?: string;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
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
  if (assigned_by !== undefined) updatePayload.assigned_by = assigned_by;
  if (instructions !== undefined) updatePayload.instructions = instructions;
  if (instructions_locked !== undefined) updatePayload.instructions_locked = Boolean(instructions_locked);

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
 * VA: must be assigned to the task. Can update their assignee row and task metadata.
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
  };

  const { data: taskContext, error: taskContextError } = await supabase
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

  const hasMetadataUpdate =
    account !== undefined ||
    project !== undefined ||
    task_name !== undefined ||
    task_detail !== undefined ||
    task_notes !== undefined ||
    due_date !== undefined ||
    assigned_by !== undefined ||
    instructions !== undefined ||
    instructions_locked !== undefined ||
    archived_at !== undefined ||
    deleted_at !== undefined;
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

  if (isTaskOwner && (hasMetadataUpdate || bodyVaId !== undefined || log_id !== undefined || notes !== undefined)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (hasMetadataUpdate && !isAdminOrManager) {
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

  const now = new Date().toISOString();

  if (hasTaskLevelStatusUpdate) {
    const { error: taskStatusError } = await adminSupabase
      .from("assigned_tasks")
      .update({ status, updated_at: now })
      .eq("id", id);

    if (taskStatusError) {
      return Response.json({ error: taskStatusError.message }, { status: 500 });
    }

    const { error: assigneeStatusError } = await adminSupabase
      .from("assigned_task_assignees")
      .update({ status, updated_at: now })
      .eq("assigned_task_id", id);

    if (assigneeStatusError) {
      return Response.json({ error: assigneeStatusError.message }, { status: 500 });
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
    } else {
      targetVaId = user.id;
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: now,
    };
    if (status !== undefined) updatePayload.status = status;
    if (log_id !== undefined) updatePayload.log_id = log_id;
    if (notes !== undefined) updatePayload.notes = notes;

    const assigneeClient = isAdminOrManager ? adminSupabase : supabase;
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

