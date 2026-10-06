import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { FixedPayTaskAttachment } from "@/types/database";
import { hasAdminPermission } from "@/lib/adminPermissions";
import { canManageFixedPayAttachments } from "@/lib/fixedPayAttachmentAccess";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ATTACHMENT_SELECT = "id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at";

// Signs the caller in and says whether they're admin-equivalent. Non-admins are
// not turned away here any more: the VA who owns an Output Based task has to be
// able to attach files to it, so the per-task ownership check (authorizeForTask)
// decides for them instead.
async function authenticate() {
  const supabase = await createClient();
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

  const isAdminLike =
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    hasAdminPermission(profile, "task_management");

  // Plain VAs (and permission-granted ones) don't pass the DB's
  // is_admin_or_manager() RLS check, so every operation below uses the
  // service-role client once the app-layer check has cleared the caller.
  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { supabase: admin, userId: user.id, isAdminLike };
}

type RouteContext = { params: Promise<{ id: string }> };

// 404 if the task doesn't exist, 403 if the caller is neither admin-equivalent
// nor the VA who claimed or created it. Returns an error Response, or null when
// the caller may proceed.
async function authorizeForTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: number,
  userId: string,
  isAdminLike: boolean
): Promise<Response | null> {
  const { data, error } = await supabase
    .from("fixed_pay_tasks")
    .select("id, claimed_by, created_by")
    .eq("id", taskId)
    .single();
  if (error || !data) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (!canManageFixedPayAttachments({ isAdminLike, userId, claimedBy: data.claimed_by, createdBy: data.created_by })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

async function buildAttachmentResponse(supabase: Awaited<ReturnType<typeof createClient>>, rows: FixedPayTaskAttachment[]) {
  return Promise.all(
    rows.map(async (row) => {
      const { data } = await supabase.storage.from("task-attachments").createSignedUrl(row.storage_path, 3600);
      return { ...row, url: data?.signedUrl ?? null };
    })
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { supabase, userId, isAdminLike } = auth;
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const denied = await authorizeForTask(supabase, taskId, userId, isAdminLike);
  if (denied) return denied;

  const { data, error } = await supabase
    .from("fixed_pay_task_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("task_id", taskId)
    .order("uploaded_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const attachments = await buildAttachmentResponse(supabase, (data ?? []) as FixedPayTaskAttachment[]);
  return Response.json({ attachments });
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { supabase, userId, isAdminLike } = auth;
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const denied = await authorizeForTask(supabase, taskId, userId, isAdminLike);
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > 52428800) {
    return Response.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `fixed-pay-tasks/${taskId}/${timestamp}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage.from("task-attachments").upload(storagePath, arrayBuffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: attachment, error: dbError } = await supabase
    .from("fixed_pay_task_attachments")
    .insert({
      task_id: taskId,
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: userId,
    })
    .select(ATTACHMENT_SELECT)
    .single();

  if (dbError) {
    await supabase.storage.from("task-attachments").remove([storagePath]);
    return Response.json({ error: dbError.message }, { status: 500 });
  }

  const [signedAttachment] = await buildAttachmentResponse(supabase, [attachment as FixedPayTaskAttachment]);
  return Response.json({ attachment: signedAttachment }, { status: 201 });
}

/**
 * DELETE /api/fixed-pay-tasks/[id]/attachments?attachmentId=<id>
 * Remove one file from the task. Same access rule as GET/POST: admin-equivalents,
 * or the VA who claimed or created the task. The route was missing, so the
 * editor's Delete button on an Output Based task got a 405 and nothing happened.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { supabase, userId, isAdminLike } = auth;
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const denied = await authorizeForTask(supabase, taskId, userId, isAdminLike);
  if (denied) return denied;

  // Number(null) is 0, which would pass an isFinite check and fall through to a
  // misleading 404 — a missing param has to be rejected before converting.
  const rawAttachmentId = new URL(request.url).searchParams.get("attachmentId");
  const attachmentId = rawAttachmentId ? Number(rawAttachmentId) : NaN;
  if (!Number.isFinite(attachmentId)) {
    return Response.json({ error: "attachmentId is required" }, { status: 400 });
  }

  // Scoped to this task, so an id belonging to another task's file can't be
  // removed by naming it under a task the caller does own.
  const { data: attachment, error: fetchError } = await supabase
    .from("fixed_pay_task_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .eq("task_id", taskId)
    .single();
  if (fetchError || !attachment) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Row first. If the storage removal then fails the worst case is an orphaned
  // file nobody can see, rather than a listed attachment whose file is gone.
  const { error: deleteError } = await supabase.from("fixed_pay_task_attachments").delete().eq("id", attachmentId);
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }
  await supabase.storage.from("task-attachments").remove([attachment.storage_path]);

  return new Response(null, { status: 204 });
}
