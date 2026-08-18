import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FixedPayTaskWithClaimer } from "@/types/database";
import { hasAdminPermission } from "@/lib/adminPermissions";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TASK_STATUSES = new Set(["open", "pending", "on_queue", "in_progress", "submitted", "revision_needed", "completed", "cancelled", "paid"]);
// Statuses a VA may set on their own claimed task. Revision Needed, Completed,
// Cancelled, and Paid are review/payroll actions — admin only.
const VA_EDITABLE_STATUSES = new Set(["open", "pending", "on_queue", "in_progress", "submitted"]);
// Fields a VA may edit on their own task, and only while it's still in a
// VA_EDITABLE_STATUSES state — once admin has moved it into review/payroll
// (revision_needed/completed/cancelled/paid), the rate and details are
// locked so a VA can't retroactively change what they're being paid for.
const VA_EDITABLE_FIELDS = new Set(["task_name", "account", "category", "project", "project_id", "rate", "task_detail", "task_notes", "link", "instructions", "start_date", "due_date", "end_date"]);
const TASK_SELECT =
  "id, task_name, account, category, project, project_id, rate, is_active, archived_at, deleted_at, task_detail, task_notes, link, instructions, instructions_locked, status, start_date, due_date, end_date, assigned_to, assigned_by, claimed_by, claimed_at, created_by, created_at, updated_at, projects(id, name)";

type ProfileSummary = { id: string; full_name: string; username: string };

// Lets any authenticated user through — callers branch on `role` to decide
// what that user is actually allowed to do.
async function requireAuthed() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) as Response };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, admin_permissions")
    .eq("id", user.id)
    .single();

  if (error) {
    return { error: Response.json({ error: error.message }, { status: 500 }) as Response };
  }

  return {
    userId: user.id,
    role: profile?.role ?? null,
    isPermitted:
      profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management"),
  };
}

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isValidStatus(value: unknown): value is FixedPayTaskWithClaimer["status"] {
  return typeof value === "string" && TASK_STATUSES.has(value);
}

function normalizeText(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseRate(value: unknown): number | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Fixed-pay tasks store start_date/due_date as plain dates (no time-of-day),
// so this normalizes to YYYY-MM-DD rather than a full ISO timestamp.
function normalizeDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function hydrateTaskProfiles(client: Pick<SupabaseClient, "from">, rows: FixedPayTaskWithClaimer[]) {
  const profileIds = [...new Set(rows.flatMap((row) => [row.claimed_by, row.assigned_to, row.assigned_by, row.created_by]).filter((id): id is string => Boolean(id)))];
  let profileMap: Record<string, ProfileSummary> = {};

  if (profileIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, username")
      .in("id", profileIds);

    profileMap = Object.fromEntries((profiles ?? []).map((profile: ProfileSummary) => [profile.id, profile]));
  }

  return rows.map((row) => ({
    ...row,
    assigned_by_profile: row.assigned_by ? profileMap[row.assigned_by] ?? null : null,
    claimed_by_profile: row.claimed_by ? profileMap[row.claimed_by] ?? null : null,
    assigned_to_profile: row.assigned_to ? profileMap[row.assigned_to] ?? null : null,
    created_by_profile: row.created_by ? profileMap[row.created_by] ?? null : null,
  }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthed();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const isAdminOrManager = auth.isPermitted;

  if (!isAdminOrManager) {
    // VA self-service: either a status change (restricted to non-review/
    // payroll values) or an edit of the whitelisted task fields — both only
    // on a task they've actually claimed, and only while it hasn't already
    // moved into a review/payroll status (once admin has acted on it, the
    // details and rate are locked).
    const body = await request.json();
    const bodyKeys = Object.keys(body);
    const isStatusOnly = bodyKeys.length === 1 && bodyKeys[0] === "status";
    const isFieldEdit = bodyKeys.length > 0 && bodyKeys.every((key) => VA_EDITABLE_FIELDS.has(key));
    if (!isStatusOnly && !isFieldEdit) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isStatusOnly) {
      const status = String(body.status ?? "");
      if (!VA_EDITABLE_STATUSES.has(status)) {
        return Response.json({ error: "That status can only be set by an admin" }, { status: 403 });
      }
    }

    const admin = makeAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("fixed_pay_tasks")
      .select("claimed_by, status")
      .eq("id", taskId)
      .single();

    if (existingError || !existing) {
      return Response.json({ error: existingError?.message || "Task not found" }, { status: 404 });
    }
    if (existing.claimed_by !== auth.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isFieldEdit && !VA_EDITABLE_STATUSES.has(existing.status)) {
      return Response.json({ error: "This task has already been reviewed and can no longer be edited" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (isStatusOnly) {
      updates.status = String(body.status ?? "");
    } else {
      if ("task_name" in body) {
        const taskName = String(body.task_name ?? "").trim();
        if (!taskName) return Response.json({ error: "task_name is required" }, { status: 400 });
        updates.task_name = taskName;
      }
      if ("account" in body) updates.account = normalizeText(body.account);
      if ("category" in body) updates.category = normalizeText(body.category);
      if ("project" in body) updates.project = normalizeText(body.project);
      if ("project_id" in body) updates.project_id = normalizeText(body.project_id);
      if ("rate" in body) {
        const rate = parseRate(body.rate);
        if (rate === null) return Response.json({ error: "rate is required" }, { status: 400 });
        updates.rate = rate;
      }
      if ("task_detail" in body) updates.task_detail = normalizeText(body.task_detail);
      if ("task_notes" in body) updates.task_notes = normalizeText(body.task_notes);
      if ("link" in body) updates.link = normalizeText(body.link);
      if ("instructions" in body) updates.instructions = normalizeText(body.instructions);
      if ("start_date" in body) updates.start_date = normalizeDate(body.start_date);
      if ("due_date" in body) updates.due_date = normalizeDate(body.due_date);
      if ("end_date" in body) updates.end_date = normalizeDate(body.end_date);
    }

    const { data, error } = await admin
      .from("fixed_pay_tasks")
      .update(updates)
      .eq("id", taskId)
      .select(TASK_SELECT)
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const [task] = await hydrateTaskProfiles(admin, [data as unknown as FixedPayTaskWithClaimer]);
    return Response.json({ task });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  const now = new Date().toISOString();
  const hasAssignedTo = Object.prototype.hasOwnProperty.call(body, "assigned_to");
  const nextAssignedTo = hasAssignedTo ? normalizeText(body.assigned_to) : undefined;
  const hasArchivedAt = Object.prototype.hasOwnProperty.call(body, "archived_at");
  const hasDeletedAt = Object.prototype.hasOwnProperty.call(body, "deleted_at");
  const nextArchivedAt = hasArchivedAt ? normalizeTimestamp(body.archived_at) : undefined;
  const nextDeletedAt = hasDeletedAt ? normalizeTimestamp(body.deleted_at) : undefined;
  let currentTaskForAssignment:
    | { claimed_by: string | null; task_name: string | null; account: string | null; category: string | null; project: string | null }
    | null = null;

  if ("task_name" in body) {
    const taskName = String(body.task_name ?? "").trim();
    if (!taskName) return Response.json({ error: "task_name is required" }, { status: 400 });
    updates.task_name = taskName;
  }
  if ("account" in body) updates.account = normalizeText(body.account);
  if ("category" in body) updates.category = normalizeText(body.category);
  if ("project" in body) updates.project = normalizeText(body.project);
  if ("project_id" in body) updates.project_id = normalizeText(body.project_id);
  if ("rate" in body) {
    const rate = parseRate(body.rate);
    if (rate === null) return Response.json({ error: "rate is required" }, { status: 400 });
    updates.rate = rate;
  }
  if ("task_detail" in body) updates.task_detail = normalizeText(body.task_detail);
  if ("task_notes" in body) updates.task_notes = normalizeText(body.task_notes);
  if ("link" in body) updates.link = normalizeText(body.link);
  if ("instructions" in body) updates.instructions = normalizeText(body.instructions);
  if ("instructions_locked" in body) updates.instructions_locked = Boolean(body.instructions_locked);
  if ("start_date" in body) updates.start_date = normalizeDate(body.start_date);
  if ("due_date" in body) updates.due_date = normalizeDate(body.due_date);
  if ("end_date" in body) updates.end_date = normalizeDate(body.end_date);
  if (hasArchivedAt) updates.archived_at = nextArchivedAt;
  if (hasDeletedAt) updates.deleted_at = nextDeletedAt;
  if ("status" in body) {
    const status = String(body.status ?? "");
    if (!isValidStatus(status)) {
      return Response.json({ error: "status is invalid" }, { status: 400 });
    }
    updates.status = status;
  }
  if (hasAssignedTo) updates.assigned_to = nextAssignedTo;
  if ("assigned_by" in body) updates.assigned_by = normalizeText(body.assigned_by);
  if ("is_active" in body) updates.is_active = Boolean(body.is_active);
  if (hasArchivedAt || hasDeletedAt) {
    const isInactive = Boolean(nextArchivedAt || nextDeletedAt);
    updates.is_active = isInactive ? false : "is_active" in body ? Boolean(body.is_active) : true;
  }

  const revokeClaim = Object.prototype.hasOwnProperty.call(body, "claimed_by") && body.claimed_by === null;
  if (revokeClaim) {
    updates.claimed_by = null;
    updates.claimed_at = null;
    updates.assigned_to = null;
  } else if ("claimed_by" in body) {
    const claimedBy = normalizeText(body.claimed_by);
    if (!claimedBy) {
      return Response.json({ error: "claimed_by is required" }, { status: 400 });
    }
    updates.claimed_by = claimedBy;
    updates.claimed_at = new Date().toISOString();
  }

  const admin = makeAdminClient();

  if (revokeClaim) {
    const { error: deleteError } = await admin
      .from("assigned_tasks")
      .delete()
      .eq("fixed_pay_task_id", taskId)
      .is("deleted_at", null);

    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }
  }

  if (nextAssignedTo) {
    const { data: currentTask, error: currentTaskError } = await admin
      .from("fixed_pay_tasks")
      .select("claimed_by, task_name, account, category, project")
      .eq("id", taskId)
      .single();

    if (currentTaskError || !currentTask) {
      return Response.json({ error: currentTaskError?.message || "Task not found" }, { status: 404 });
    }

    currentTaskForAssignment = currentTask;
    if (currentTask.claimed_by !== nextAssignedTo) {
      updates.claimed_by = nextAssignedTo;
      updates.claimed_at = now;
    }
  }

  const { data, error } = await admin
    .from("fixed_pay_tasks")
    .update(updates)
    .eq("id", taskId)
    .select(TASK_SELECT)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (nextAssignedTo) {
    const { error: deleteError } = await admin
      .from("assigned_tasks")
      .delete()
      .eq("fixed_pay_task_id", taskId)
      .is("deleted_at", null);

    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }

    const taskForAssignment = currentTaskForAssignment ?? {
      claimed_by: data.claimed_by,
      task_name: data.task_name,
      account: data.account,
      category: data.category,
      project: data.project,
    };

    const { data: assignedTask, error: assignedTaskError } = await admin
      .from("assigned_tasks")
      .insert({
        account: taskForAssignment.account,
        project: taskForAssignment.project ?? taskForAssignment.category,
        task_name: taskForAssignment.task_name,
        task_detail: null,
        task_notes: null,
        due_date: null,
        created_by: auth.userId,
        assigned_by: auth.userId,
        fixed_pay_task_id: taskId,
      })
      .select("id, account, project, task_name, task_detail, task_notes, due_date, created_by, fixed_pay_task_id, created_at, updated_at")
      .single();

    if (assignedTaskError || !assignedTask) {
      return Response.json({ error: assignedTaskError?.message || "Unable to create assigned task" }, { status: 500 });
    }

    const { error: assigneeError } = await admin
      .from("assigned_task_assignees")
      .insert({
        assigned_task_id: assignedTask.id,
        va_id: nextAssignedTo,
        status: "on_queue",
      })
      .select("id, assigned_task_id, va_id, status, log_id, notes, assigned_at, updated_at")
      .single();

    if (assigneeError) {
      await admin.from("assigned_tasks").delete().eq("id", assignedTask.id);
      return Response.json({ error: assigneeError.message || "Unable to create task assignment" }, { status: 500 });
    }
  }

  const [task] = await hydrateTaskProfiles(admin, [data as unknown as FixedPayTaskWithClaimer]);
  return Response.json({ task });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthed();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const isAdminOrManager = auth.isPermitted;
  const admin = makeAdminClient();

  if (!isAdminOrManager) {
    // VA self-service: only their own task, and only while it hasn't already
    // moved into a review/payroll status (mirrors the edit restriction above
    // — once admin has acted on it, a VA deleting it would erase the record
    // of work that may already be approved or paid).
    const { data: existing, error: existingError } = await admin
      .from("fixed_pay_tasks")
      .select("claimed_by, status")
      .eq("id", taskId)
      .single();

    if (existingError || !existing) {
      return Response.json({ error: existingError?.message || "Task not found" }, { status: 404 });
    }
    if (existing.claimed_by !== auth.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!VA_EDITABLE_STATUSES.has(existing.status)) {
      return Response.json({ error: "This task has already been reviewed and can no longer be deleted" }, { status: 403 });
    }
  }

  // Clean up the assigned_tasks row created during auto-claim (see POST),
  // so deleting the fixed-pay task doesn't leave a phantom assignment behind.
  const { error: assignedTaskDeleteError } = await admin
    .from("assigned_tasks")
    .delete()
    .eq("fixed_pay_task_id", taskId);
  if (assignedTaskDeleteError) {
    return Response.json({ error: assignedTaskDeleteError.message }, { status: 500 });
  }

  const { error } = await admin.from("fixed_pay_tasks").delete().eq("id", taskId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
