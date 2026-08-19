import { createClient } from "@/lib/supabase/server";
import { canAccessProject, serviceClient } from "@/lib/projectAccess";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 52428800; // 50MB, same limit as task attachments
const BUCKET = "task-attachments"; // shared bucket — every attachment surface in
// this app uses it; no reason for Docs & Files to be the exception.

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

/**
 * GET /api/project-files?projectId=<uuid>
 * List files for one Operation/Objective, newest first, each with a 1-hour
 * signed URL — same expiry the task-attachments route uses. Access gated by
 * canAccessProject, same rule as Message Board.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

  const supabase = serviceClient();
  if (!(await canAccessProject(supabase, profile, user.id, projectId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("project_files")
    .select(
      "id, project_id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at, uploader:profiles!project_files_uploaded_by_fkey(id, full_name, username)"
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const files = await Promise.all(
    (data ?? []).map(async (file) => {
      const { data: signedData } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(file.storage_path, 3600);
      return { ...file, url: signedData?.signedUrl ?? null };
    })
  );

  return Response.json({ files });
}

/**
 * POST /api/project-files
 * multipart/form-data: project_id, file (one or more)
 * Same canAccessProject rule as reading — the project's assigned VAs, its
 * creator, and admins can all upload.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || !projectId) {
    return Response.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = serviceClient();
  if (!(await canAccessProject(supabase, profile, user.id, projectId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const uploadedPaths: string[] = [];
  const insertedIds: string[] = [];
  const results: Array<Record<string, unknown> & { url: string | null }> = [];

  try {
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`${file.name} is too large (max 50MB)`);
      }

      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `operations/${projectId}/${timestamp}-${index}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, arrayBuffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPaths.push(storagePath);

      const { data: fileRow, error: dbError } = await supabase
        .from("project_files")
        .insert({
          project_id: projectId,
          filename: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          uploaded_by: user.id,
        })
        .select(
          "id, project_id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at, uploader:profiles!project_files_uploaded_by_fkey(id, full_name, username)"
        )
        .single();
      if (dbError || !fileRow) throw new Error(dbError?.message || "Unable to save file record");
      insertedIds.push(fileRow.id as string);

      const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
      results.push({ ...fileRow, url: signedData?.signedUrl ?? null });
    }
  } catch (error) {
    if (insertedIds.length > 0) {
      await supabase.from("project_files").delete().in("id", insertedIds);
    }
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(BUCKET).remove(uploadedPaths);
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to upload file" },
      { status: 500 }
    );
  }

  return Response.json(files.length === 1 ? { file: results[0], files: results } : { files: results }, {
    status: 201,
  });
}

/**
 * DELETE /api/project-files?id=<uuid>
 * Soft delete — uploader-or-admin, same convention as Message Board (not
 * admin-only, unlike the task-attachments route this was modeled on: a VA
 * assigned to the Operation should be able to remove their own upload).
 */
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const isAdmin = hasBroadAdminAccess(profile);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("project_files")
    .select("uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return Response.json({ error: "File not found" }, { status: 404 });
  if (!isAdmin && existing.uploaded_by !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("project_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
