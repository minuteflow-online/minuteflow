import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { canChangeLockedReview } from "@/lib/financialAccess";

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

const TASK_SELECT =
  "id, account, project, project_id, parent_task_id, pay_type, category, task_name, task_detail, task_notes, link, due_date, due_time, start_date, end_date, start_time, end_time, assigned_by, instructions, instructions_locked, review_required, review_required_locked, assigned_task_assignees(id, va_id, status)";

const REVIEW_LOCKED_ERROR =
  "Forbidden: Review Required is locked at Yes. Only Admin, Manager, CEO, or Founder can change it.";

/** Columns isReviewLocked needs — select exactly these before calling it. */
const REVIEW_LOCK_SELECT = "review_required, review_required_locked";

/**
 * The only statuses a VA may set on a task marked Review Required.
 *
 * They can move their own work forward and hand it in, and nothing further:
 * approved/completed/paid are the sign-off the review exists to require, and
 * revision_needed is the reviewer's verdict on the work — a VA declaring their
 * own submission in need of revision would be answering the review themselves.
 *
 * Applies to both status paths (task-level and per-assignee), so a VA can't
 * reach a blocked status through the one that wasn't checked.
 */
const VA_STATUSES_UNDER_REVIEW: AssignedTaskStatus[] = [
  "pending",
  "on_queue",
  "in_progress",
  "submitted",
];

const VA_STATUS_UNDER_REVIEW_ERROR =
  "Forbidden: task requires review — you can only set pending, on_queue, in_progress, or submitted. A reviewer decides the rest.";

/**
 * Whether a task's Review Required answer is locked against ordinary edits.
 *
 * Only YES locks. Saying a task needs review is the commitment worth
 * protecting — a VA shouldn't be able to quietly take it back and skip the
 * review. NO is not a commitment, so it stays freely changeable and anyone can
 * still escalate the task to Yes later. The lock is deliberately one-way.
 *
 * `review_required` is checked alongside the flag so a row locked at No by the
 * earlier version of this rule reads as unlocked rather than staying stuck.
 *
 * All three write paths (admin PUT, admin PATCH, VA standalone) call this, so
 * the rule can't drift between them. It takes the row rather than the client
 * because the service-role client's generics don't survive being passed around.
 */
function isReviewLocked(
  row: { review_required?: boolean | null; review_required_locked?: boolean | null } | null | undefined
): boolean {
  return Boolean(row?.review_required_locked) && Boolean(row?.review_required);
}

/**
 * GET /api/assigned-tasks/[id]
 * Full row for a single task — used to prefill edit forms (e.g. TaskEditor)
 * with fields the list views don't carry. Admin/manager can view any task;
 * VAs must be an assignee.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  const { data: task, error } = await supabase
    .from("assigned_tasks")
    .select(TASK_SELECT)
    .eq("id", id)
    .single();

  if (error || !task) return Response.json({ error: "Task not found" }, { status: 404 });

  const isAdminOrManager =
    profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
  if (!isAdminOrManager) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assignees = ((task as any).assigned_task_assignees ?? []) as Array<{ va_id: string }>;
    if (!assignees.some((a) => a.va_id === user.id)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return Response.json({ task });
}

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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const isPutPermitted =
    profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
  if (!isPutPermitted) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission-granted plain VAs don't pass the DB's is_admin_or_manager()
  // RLS check (role stays "va"), so the writes below use the service-role
  // client once the app-layer permission check above has already cleared
  // the caller. No-op behavior change for real admins/managers.
  const adminSupabase = createAdminClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { id } = await params;

  // Confirm the task exists
  const { data: existing, error: fetchError } = await adminSupabase
    .from("assigned_tasks")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await request.json();
  const { account, project, category, task_name, task_detail, task_notes, link, due_date, due_time, start_date, end_date, start_time, end_time, assigned_by, instructions, instructions_locked, review_required: putReviewRequired, recurring_template_id, project_id, parent_task_id, va_ids } = body as {
    account?: string;
    project?: string;
    category?: string | null;
    task_name?: string;
    task_detail?: string;
    task_notes?: string;
    link?: string | null;
    due_date?: string;
    due_time?: string | null;
    start_date?: string;
    end_date?: string;
    start_time?: string | null;
    end_time?: string | null;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
    review_required?: boolean;
    recurring_template_id?: string | null;
    project_id?: string | null;
    parent_task_id?: number | null;
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
  if (link !== undefined) updatePayload.link = link;
  if (due_date !== undefined) updatePayload.due_date = due_date;
  if (due_time !== undefined) updatePayload.due_time = due_time;
  if (start_date !== undefined) updatePayload.start_date = start_date;
  if (end_date !== undefined) updatePayload.end_date = end_date;
  if (start_time !== undefined) updatePayload.start_time = start_time;
  if (end_time !== undefined) updatePayload.end_time = end_time;
  if (assigned_by !== undefined) updatePayload.assigned_by = assigned_by;
  if (instructions !== undefined) updatePayload.instructions = instructions;
  if (instructions_locked !== undefined) updatePayload.instructions_locked = Boolean(instructions_locked);
  // Only YES locks Review Required — see reviewLockedAt() for why. Undoing a
  // locked Yes is limited to Admin/Manager/CEO/Founder. This handler already
  // requires admin, manager, or the task_management grant, so the extra check
  // only bites a permission-granted Staff account, which is who the lock is for.
  if (putReviewRequired !== undefined) {
    const { data: reviewRow } = await adminSupabase
      .from("assigned_tasks")
      .select(REVIEW_LOCK_SELECT)
      .eq("id", id)
      .single();
    if (isReviewLocked(reviewRow) && !canChangeLockedReview(profile)) {
      return Response.json({ error: REVIEW_LOCKED_ERROR }, { status: 403 });
    }
    updatePayload.review_required = Boolean(putReviewRequired);
    updatePayload.review_required_locked = Boolean(putReviewRequired);
  }
  if (recurring_template_id !== undefined) updatePayload.recurring_template_id = recurring_template_id;
  if (project_id !== undefined) updatePayload.project_id = project_id;
  if (parent_task_id !== undefined) updatePayload.parent_task_id = parent_task_id;

  const { data: updatedTask, error: updateError } = await adminSupabase
    .from("assigned_tasks")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateError)
    return Response.json({ error: updateError.message }, { status: 500 });

  // Sync task_detail → client_memo on linked time_logs
  if (task_detail !== undefined) {
    const { data: assigneeRows } = await adminSupabase
      .from("assigned_task_assignees")
      .select("log_id")
      .eq("assigned_task_id", id);

    const logIds = (assigneeRows ?? [])
      .map((r: { log_id: number | null }) => r.log_id)
      .filter((lid): lid is number => typeof lid === "number");

    if (logIds.length > 0) {
      await adminSupabase
        .from("time_logs")
        .update({ client_memo: task_detail || null })
        .in("id", logIds);
    }
  }

  // Handle va_ids reconciliation if provided
  if (Array.isArray(va_ids)) {
    // Fetch current assignees
    const { data: currentAssignees, error: currentError } = await adminSupabase
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
      const { error: deleteError } = await adminSupabase
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

      const { error: insertError } = await adminSupabase
        .from("assigned_task_assignees")
        .insert(newRows);

      if (insertError)
        return Response.json({ error: insertError.message }, { status: 500 });
    }

    // If the resulting assignee list is empty, mark the task itself as unassigned
    const remainingCount =
      (currentVaIds.filter((v) => incomingVaIds.includes(v)).length) + toInsert.length;
    if (remainingCount === 0) {
      await adminSupabase
        .from("assigned_tasks")
        .update({ status: "unassigned", updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  }

  // Return updated task with current assignees
  const { data: finalAssignees, error: finalError } = await adminSupabase
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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  const isDeletePermitted =
    profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
  if (!isDeletePermitted) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission-granted plain VAs don't pass the DB's is_admin_or_manager()
  // RLS check (role stays "va"), so delete via the service-role client once
  // the app-layer permission check above has already cleared the caller.
  const adminSupabase = createAdminClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { id } = await params;

  const { error } = await adminSupabase
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
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  // Every downstream check in this handler reuses this one const, so
  // permission-granted plain VAs get admin/manager-equivalent access here
  // just by broadening this single definition — see adminPermissions.ts.
  const isAdminOrManager =
    profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
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
    category,
    task_name,
    task_detail,
    task_notes,
    link,
    due_date,
    due_time,
    start_date,
    end_date,
    start_time,
    end_time,
    assigned_by,
    instructions,
    instructions_locked,
    instructions_append,
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
    category?: string | null;
    task_name?: string;
    task_detail?: string | null;
    task_notes?: string | null;
    link?: string | null;
    due_date?: string | null;
    due_time?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    assigned_by?: string | null;
    instructions?: string | null;
    instructions_locked?: boolean;
    /** Text to append to instructions, never replacing what's there. Open to
     *  anyone who can edit the task — it's how a VA contributes a note without
     *  being able to overwrite the assigner's wording. */
    instructions_append?: string | null;
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
    category !== undefined ||
    task_name !== undefined ||
    task_detail !== undefined ||
    task_notes !== undefined ||
    link !== undefined ||
    due_date !== undefined ||
    due_time !== undefined ||
    start_date !== undefined ||
    end_date !== undefined ||
    assigned_by !== undefined ||
    instructions !== undefined ||
    instructions_locked !== undefined ||
    instructions_append !== undefined;
  // Scheduling (start_time/end_time) is intentionally kept out of hasCoreMetadataUpdate:
  // VAs get a narrow carve-out below to schedule their own tasks without full metadata
  // permissions. Admins/managers reach the same fields via the general metadata path,
  // which is why hasMetadataUpdate (not hasCoreMetadataUpdate) includes it.
  const hasScheduleUpdate = start_time !== undefined || end_time !== undefined;
  const hasMetadataUpdate =
    hasCoreMetadataUpdate ||
    archived_at !== undefined ||
    deleted_at !== undefined ||
    review_required !== undefined ||
    hasScheduleUpdate;
  const hasArchiveUpdate = archived_at !== undefined;
  const hasDeleteUpdate = deleted_at !== undefined;
  const hasArchiveOnlyUpdate =
    hasArchiveUpdate &&
    !hasDeleteUpdate &&
    !hasCoreMetadataUpdate &&
    log_id === undefined &&
    notes === undefined &&
    status === undefined;
  // Trashing (and restoring) on its own, mirroring hasArchiveOnlyUpdate. Both
  // directions are reversible — deleted_at is a soft flag the Trash view reads —
  // so a VA can bin a task they created by mistake and pull it back out.
  // Permanent delete is the DELETE handler, which stays admin-only.
  //
  // Carved out explicitly rather than left to fall through the metadata path:
  // that path is for editing fields, and a VA who OWNS the task is blocked from
  // deletes further down, which is exactly the person who mis-created it.
  const hasTrashOnlyUpdate =
    hasDeleteUpdate &&
    !hasArchiveUpdate &&
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

  // Instructions belong to whoever assigned the task — a VA can't rewrite or
  // unlock them, which is the whole point of instructions_locked. They append
  // instead, via instructions_append below, so a question or a note is added
  // without any of the original wording being lost.
  if (!isAdminOrManager && (instructions !== undefined || instructions_locked !== undefined)) {
    return Response.json(
      {
        error:
          "Forbidden: instructions are set by whoever assigned the task. Use Add to Instructions to append a note instead.",
      },
      { status: 403 }
    );
  }

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
    // A VA gets to escalate to Yes, and that locks behind them — they can't
    // undo it afterwards. Already locked at Yes means there's nothing to do
    // and no way for them to change it.
    const { data: vaReviewRow } = await adminSupabase
      .from("assigned_tasks")
      .select(REVIEW_LOCK_SELECT)
      .eq("id", id)
      .single();
    if (isReviewLocked(vaReviewRow)) {
      return Response.json({ error: REVIEW_LOCKED_ERROR }, { status: 403 });
    }
    const { error: rrError } = await adminSupabase
      .from("assigned_tasks")
      .update({ review_required: true, review_required_locked: true, updated_at: now })
      .eq("id", id);
    if (rrError) {
      return Response.json({ error: rrError.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  // VA-only: allow a VA to schedule (set/clear start_time and end_time) on a task
  // they're an assignee of — personal hour-block scheduling from the Calendar day
  // view. Scoped narrowly so it doesn't grant broader metadata-edit permission.
  const hasScheduleOnlyUpdate =
    hasScheduleUpdate &&
    !hasCoreMetadataUpdate &&
    !hasAssigneeUpdate &&
    archived_at === undefined &&
    deleted_at === undefined &&
    review_required === undefined;
  if (!isAdminOrManager && hasScheduleOnlyUpdate) {
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
    const { error: scheduleError } = await adminSupabase
      .from("assigned_tasks")
      .update({ start_time: start_time ?? null, end_time: end_time ?? null, updated_at: now })
      .eq("id", id);
    if (scheduleError) {
      return Response.json({ error: scheduleError.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  // A task owner acting on their OWN assignee row is just an ordinary assignee and must
  // be allowed the same log_id/notes writes as anyone else. Without this, a VA who is
  // both the assigner and an assignee (the normal shape for tasks created from the
  // Projects tab) got a 403 when hitting Start, because the Start PATCH carries log_id —
  // so their assignee row never moved to in_progress and the button stayed on "Start".
  const isSelfTargetedAssigneeUpdate = bodyVaId === undefined || bodyVaId === user.id;

  // VA trash / restore. Runs before the owner guard below, which blocks deletes
  // for non-admin owners — the very person who created the task by mistake.
  // Allowed for an assignee or the owner; anyone else still gets a 403.
  if (!isAdminOrManager && hasTrashOnlyUpdate) {
    let permitted = isTaskOwner;
    if (!permitted) {
      const { data: assigneeRow } = await supabase
        .from("assigned_task_assignees")
        .select("id")
        .eq("assigned_task_id", id)
        .eq("va_id", user.id)
        .limit(1)
        .maybeSingle();
      permitted = Boolean(assigneeRow);
    }
    if (!permitted) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const { error: trashError } = await adminSupabase
      .from("assigned_tasks")
      .update({ deleted_at, updated_at: now })
      .eq("id", id);
    if (trashError) {
      return Response.json({ error: trashError.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  // Task owners (non-admin) may pass va_id to target ANOTHER assignee's row, but only for
  // status-only updates (e.g., reviewing submitted work). Block everything else.
  // Core metadata is no longer in this list — a VA who created and assigned the
  // task can edit its fields like any other assignee (see the metadata note
  // below); deleting it, and writing another assignee's log/notes, still aren't
  // theirs to do.
  if (
    isTaskOwner &&
    !isAdminOrManager &&
    (hasDeleteUpdate ||
      ((log_id !== undefined || notes !== undefined) && !isSelfTargetedAssigneeUpdate))
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

  // A VA may edit the metadata of a task they're on — due date, dates, name,
  // client detail, notes, link, category. Previously any metadata field at all
  // was a flat 403 for non-admins, so a VA could set her hours (carved out
  // above) but not move her own due date, and the bare "Forbidden" gave no clue
  // why. Assignee membership is still checked immediately below; instructions
  // are rejected earlier; and review_required keeps its own rules.

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
      if (!VA_STATUSES_UNDER_REVIEW.includes(status)) {
        return Response.json({ error: VA_STATUS_UNDER_REVIEW_ERROR }, { status: 403 });
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
      // The revision is counted the moment it's issued, so the R exists from
      // then on — already showing when the VA moves the task back to on_queue
      // and reworks it.
      await adminSupabase
        .from("assigned_tasks")
        .update({ revision_count: (taskForReview?.revision_count ?? 0) + 1, updated_at: now })
        .eq("id", id);

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
      if (!VA_STATUSES_UNDER_REVIEW.includes(status)) {
        return Response.json({ error: VA_STATUS_UNDER_REVIEW_ERROR }, { status: 403 });
      }
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: now,
    };
    if (status !== undefined) updatePayload.status = status;
    if (log_id !== undefined) updatePayload.log_id = log_id;
    if (notes !== undefined) updatePayload.notes = notes;

    const { data: priorAssigneeRow } = await adminSupabase
      .from("assigned_task_assignees")
      .select("accuracy_score")
      .eq("assigned_task_id", id)
      .eq("va_id", targetVaId)
      .maybeSingle();

    if (status === "revision_needed") {
      // Decrement accuracy_score by 10 on the targeted row
      if (priorAssigneeRow) {
        updatePayload.accuracy_score = (priorAssigneeRow.accuracy_score as number) - 10;
      }

      // Count the revision the moment it's issued. This is the path an admin's
      // "Request Revision" takes, and it's the one that was silently never
      // counting: the parent task's status is only synced for non-admins, so
      // the old exit-triggered increment never saw revision_needed and the R
      // badge never appeared at all.
      await adminSupabase
        .from("assigned_tasks")
        .update({ revision_count: (taskForReview?.revision_count ?? 0) + 1, updated_at: now })
        .eq("id", id);
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
    if (category !== undefined) updatePayload.category = category;
    if (task_name !== undefined) updatePayload.task_name = task_name.trim();
    if (task_detail !== undefined) updatePayload.task_detail = task_detail;
    if (task_notes !== undefined) updatePayload.task_notes = task_notes;
    if (link !== undefined) updatePayload.link = link;
    if (due_date !== undefined) updatePayload.due_date = due_date;
    if (due_time !== undefined) updatePayload.due_time = due_time;
    if (start_date !== undefined) updatePayload.start_date = start_date;
    if (end_date !== undefined) updatePayload.end_date = end_date;
    if (start_time !== undefined) updatePayload.start_time = start_time;
    if (end_time !== undefined) updatePayload.end_time = end_time;
    if (assigned_by !== undefined) updatePayload.assigned_by = assigned_by;
    if (instructions !== undefined) updatePayload.instructions = instructions;
    if (instructions_locked !== undefined) updatePayload.instructions_locked = Boolean(instructions_locked);
    // Append, never replace — read the current text and add to the end, so two
    // people adding notes can't wipe each other's and the assigner's original
    // wording always survives. Attributed, because an unattributed line
    // appearing in the assigner's own instructions is worse than no note.
    if (typeof instructions_append === "string" && instructions_append.trim()) {
      const { data: current } = await adminSupabase
        .from("assigned_tasks")
        .select("instructions")
        .eq("id", id)
        .single();
      const { data: author } = await adminSupabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", user.id)
        .single();
      const who = author?.full_name || author?.username || "Unknown";
      const stamp = new Date(now).toISOString().slice(0, 10);
      const addition = `[${stamp} — ${who}] ${instructions_append.trim()}`;
      const existing = (current?.instructions ?? "").trimEnd();
      updatePayload.instructions = existing ? `${existing}\n\n${addition}` : addition;
    }
    if (archived_at !== undefined) updatePayload.archived_at = archived_at;
    if (deleted_at !== undefined) updatePayload.deleted_at = deleted_at;
    // Same lock rule as the PUT path: only Yes locks, and undoing a locked Yes
    // needs the Admin/Manager/CEO/Founder tier. Reachable here by a
    // permission-granted Staff account, which the lock is meant to stop.
    if (review_required !== undefined) {
      const { data: reviewRow } = await adminSupabase
        .from("assigned_tasks")
        .select(REVIEW_LOCK_SELECT)
        .eq("id", id)
        .single();
      if (isReviewLocked(reviewRow) && !canChangeLockedReview(profile)) {
        return Response.json({ error: REVIEW_LOCKED_ERROR }, { status: 403 });
      }
      updatePayload.review_required = Boolean(review_required);
      updatePayload.review_required_locked = Boolean(review_required);
    }

    // Reachable by an admin/manager, or by a VA on a task they're an assignee
    // of or own — the guards above establish which. The service-role client is
    // necessary either way, since neither a permission-granted plain VA nor an
    // ordinary assignee passes RLS on the session client for this write. What
    // a VA is allowed to change is bounded by those guards, not by RLS: they
    // never reach here with instructions or a locked review answer in hand.
    const { error: taskError } = await adminSupabase
      .from("assigned_tasks")
      .update(updatePayload)
      .eq("id", id);

    if (taskError) {
      return Response.json({ error: taskError.message }, { status: 500 });
    }

    // Sync task_detail → client_memo on linked time_logs
    if (task_detail !== undefined) {
      const { data: assigneeRows } = await adminSupabase
        .from("assigned_task_assignees")
        .select("log_id")
        .eq("assigned_task_id", id);

      const logIds = (assigneeRows ?? [])
        .map((r: { log_id: number | null }) => r.log_id)
        .filter((lid): lid is number => typeof lid === "number");

      if (logIds.length > 0) {
        await adminSupabase
          .from("time_logs")
          .update({ client_memo: task_detail || null })
          .in("id", logIds);
      }
    }
  }

  return Response.json({ ok: true });
}

