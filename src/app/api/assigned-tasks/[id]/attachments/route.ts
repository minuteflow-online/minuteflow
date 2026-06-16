import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function canAccessAttachments(supabase: Awaited<ReturnType<typeof createClient>>, taskId: string, userId: string, role?: string | null) {
  if (role === "admin" || role === "manager") return true;

  const { data, error } = await supabase
    .from("assigned_task_assignees")
    .select("id")
    .eq("assigned_task_id", taskId)
    .eq("va_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return Boolean(data);
}

/**
 * GET /api/assigned-tasks/[id]/attachments
 * Returns all attachments for a task. Admin/manager can view any task; VAs can view tasks assigned to them.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessAttachments(supabase, id, user.id, profile?.role ?? null);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("assigned_task_attachments")
    .select("id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at")
    .eq("assigned_task_id", id)
    .order("uploaded_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Generate signed URLs for each attachment (1 hour expiry)
  const attachments = await Promise.all(
    (data ?? []).map(async (att) => {
      const { data: signedData } = await supabase.storage
        .from("task-attachments")
        .createSignedUrl(att.storage_path, 3600);
      return {
        ...att,
        url: signedData?.signedUrl ?? null,
      };
    })
  );

  return Response.json({ attachments });
}

/**
 * POST /api/assigned-tasks/[id]/attachments
 * Upload a file attachment for a task. Admin/manager can upload any task; VAs can upload to tasks assigned to them.
 * Accepts multipart/form-data with a "file" field.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    const allowed = await canAccessAttachments(supabase, id, user.id, profile?.role ?? null);
    if (!allowed) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to verify access" }, { status: 500 });
  }

  const { data: task, error: taskError } = await supabase
    .from("assigned_tasks")
    .select("id")
    .eq("id", id)
    .single();

  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const files = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    const singleFile = formData.get("file");
    if (singleFile instanceof File) files.push(singleFile);
  }

  if (files.length === 0) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const uploadedPaths: string[] = [];
  const insertedIds: number[] = [];
  const attachments: Array<Record<string, unknown> & { url: string | null }> = [];

  try {
    for (const [index, file] of files.entries()) {
      if (file.size > 52428800) {
        throw new Error("File too large (max 50MB)");
      }

      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `tasks/${id}/${timestamp}-${index}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await admin.storage
        .from("task-attachments")
        .upload(storagePath, arrayBuffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploadedPaths.push(storagePath);

      const { data: attachment, error: dbError } = await admin
        .from("assigned_task_attachments")
        .insert({
          assigned_task_id: Number(id),
          filename: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          uploaded_by: user.id,
        })
        .select("id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at")
        .single();

      if (dbError || !attachment) {
        throw new Error(dbError?.message || "Unable to save attachment record");
      }

      insertedIds.push(attachment.id as number);

      const { data: signedData } = await admin.storage
        .from("task-attachments")
        .createSignedUrl(storagePath, 3600);

      attachments.push({ ...attachment, url: signedData?.signedUrl ?? null });
    }
  } catch (error) {
    if (insertedIds.length > 0) {
      await admin.from("assigned_task_attachments").delete().in("id", insertedIds);
    }
    if (uploadedPaths.length > 0) {
      await admin.storage.from("task-attachments").remove(uploadedPaths);
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to upload attachment" },
      { status: 500 }
    );
  }

  return Response.json(
    files.length === 1
      ? { attachment: attachments[0], attachments }
      : { attachments },
    { status: 201 }
  );
}

/**
 * DELETE /api/assigned-tasks/[id]/attachments?attachmentId=<id>
 * Delete a specific attachment. Admin/manager only.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
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

  if (!["admin", "manager"].includes(profile?.role ?? "")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const attachmentId = searchParams.get("attachmentId");

  if (!attachmentId) {
    return Response.json({ error: "attachmentId is required" }, { status: 400 });
  }

  // Fetch the attachment record (to get storage_path)
  const { data: att, error: fetchError } = await supabase
    .from("assigned_task_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .eq("assigned_task_id", id)
    .single();

  if (fetchError || !att) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from("task-attachments").remove([att.storage_path]);

  // Delete DB record
  const { error: deleteError } = await supabase
    .from("assigned_task_attachments")
    .delete()
    .eq("id", attachmentId);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
