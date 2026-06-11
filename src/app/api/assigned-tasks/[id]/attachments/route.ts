import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/assigned-tasks/[id]/attachments
 * Returns all attachments for a task. Admin/manager only (VAs see tasks via VA view, not this endpoint).
 */
export async function GET(_request: Request, { params }: RouteContext) {
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
 * Upload a file attachment for a task. Admin/manager only.
 * Accepts multipart/form-data with a "file" field.
 */
export async function POST(request: Request, { params }: RouteContext) {
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

  // Verify task exists
  const { data: task, error: taskError } = await supabase
    .from("assigned_tasks")
    .select("id")
    .eq("id", id)
    .single();

  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Parse multipart form data
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

  // Build a unique storage path
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `tasks/${id}/${timestamp}-${safeName}`;

  // Upload to Supabase Storage
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("task-attachments")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  // Record in DB
  const { data: attachment, error: dbError } = await supabase
    .from("assigned_task_attachments")
    .insert({
      assigned_task_id: parseInt(id),
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: user.id,
    })
    .select("id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at")
    .single();

  if (dbError) {
    // Clean up storage on DB failure
    await supabase.storage.from("task-attachments").remove([storagePath]);
    return Response.json({ error: dbError.message }, { status: 500 });
  }

  // Return with signed URL
  const { data: signedData } = await supabase.storage
    .from("task-attachments")
    .createSignedUrl(storagePath, 3600);

  return Response.json(
    { attachment: { ...attachment, url: signedData?.signedUrl ?? null } },
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
