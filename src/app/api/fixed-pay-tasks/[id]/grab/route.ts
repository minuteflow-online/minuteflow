import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireVa() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) as Response };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) {
    return { error: Response.json({ error: error.message }, { status: 500 }) as Response };
  }
  if (profile?.role !== "va") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) as Response };
  }

  return { supabase, userId: user.id };
}

function makeAdminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVa();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const { userId } = auth;
  const admin = makeAdminClient();

  const { data: task, error: taskError } = await admin
    .from("fixed_pay_tasks")
    .select("id, task_name, account, category, rate, is_active, archived_at, deleted_at, claimed_by, claimed_at, created_by, created_at, updated_at")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.is_active) {
    return Response.json({ error: "Task is inactive" }, { status: 409 });
  }
  if (task.deleted_at) {
    return Response.json({ error: "Task is in trash" }, { status: 409 });
  }
  if (task.archived_at) {
    return Response.json({ error: "Task is archived" }, { status: 409 });
  }
  if (task.claimed_by) {
    return Response.json({ error: "Task has already been claimed" }, { status: 409 });
  }

  const claimedAt = new Date().toISOString();
  const { error: claimError } = await admin
    .from("fixed_pay_tasks")
    .update({ claimed_by: userId, claimed_at: claimedAt })
    .eq("id", taskId);

  if (claimError) {
    return Response.json({ error: claimError.message }, { status: 500 });
  }

  const { data: assignedTask, error: assignedTaskError } = await admin
    .from("assigned_tasks")
    .insert({
      account: task.account,
      project: task.category,
      task_name: task.task_name,
      task_detail: null,
      task_notes: null,
      due_date: null,
      created_by: userId,
      fixed_pay_task_id: task.id,
    })
    .select("id, account, project, task_name, task_detail, task_notes, due_date, created_by, fixed_pay_task_id, created_at, updated_at")
    .single();

  if (assignedTaskError || !assignedTask) {
    await admin.from("fixed_pay_tasks").update({ claimed_by: null, claimed_at: null }).eq("id", taskId);
    return Response.json({ error: assignedTaskError?.message || "Unable to create assigned task" }, { status: 500 });
  }

  const { data: assignee, error: assigneeError } = await admin
    .from("assigned_task_assignees")
    .insert({
      assigned_task_id: assignedTask.id,
      va_id: userId,
      status: "on_queue",
    })
    .select("id, assigned_task_id, va_id, status, log_id, notes, assigned_at, updated_at")
    .single();

  if (assigneeError || !assignee) {
    await admin.from("assigned_tasks").delete().eq("id", assignedTask.id);
    await admin.from("fixed_pay_tasks").update({ claimed_by: null, claimed_at: null }).eq("id", taskId);
    return Response.json({ error: assigneeError?.message || "Unable to create task assignment" }, { status: 500 });
  }

  return Response.json(
    {
      task: {
        ...task,
        claimed_by: userId,
        claimed_at: claimedAt,
      },
      assigned_task: {
        ...assignedTask,
        assignee,
      },
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVa();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const { userId } = auth;
  const admin = makeAdminClient();

  const { data: task, error: taskError } = await admin
    .from("fixed_pay_tasks")
    .select("id, claimed_by, claimed_at")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.claimed_by) {
    return Response.json({ error: "Task is not currently claimed" }, { status: 409 });
  }

  if (task.claimed_by !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: deleteError } = await admin
    .from("assigned_tasks")
    .delete()
    .eq("fixed_pay_task_id", taskId)
    .is("deleted_at", null);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: clearError } = await admin
    .from("fixed_pay_tasks")
    .update({ claimed_by: null, claimed_at: null })
    .eq("id", taskId);

  if (clearError) {
    return Response.json({ error: clearError.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
