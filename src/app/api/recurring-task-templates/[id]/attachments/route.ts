import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function serviceClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

async function getTemplateOr404(templateId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("recurring_task_templates")
    .select("id")
    .eq("id", templateId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const supabase = serviceClient();

  const { data, error } = await supabase
    .from("recurring_template_attachments")
    .select("id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at")
    .eq("template_id", id)
    .order("uploaded_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const attachments = await Promise.all(
    (data ?? []).map(async (attachment) => {
      const { data: signedData } = await supabase.storage
        .from("task-attachments")
        .createSignedUrl(attachment.storage_path, 3600);
      return {
        ...attachment,
        url: signedData?.signedUrl ?? null,
      };
    })
  );

  return Response.json({ attachments });
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const { id } = await params;

  const template = await getTemplateOr404(id);
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
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

  const supabase = serviceClient();
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
      const storagePath = `recurring-templates/${id}/${timestamp}-${index}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("task-attachments")
        .upload(storagePath, arrayBuffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploadedPaths.push(storagePath);

      const { data: attachment, error: dbError } = await supabase
        .from("recurring_template_attachments")
        .insert({
          template_id: id,
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

      const { data: signedData } = await supabase.storage
        .from("task-attachments")
        .createSignedUrl(storagePath, 3600);

      attachments.push({ ...attachment, url: signedData?.signedUrl ?? null });
    }
  } catch (error) {
    if (insertedIds.length > 0) {
      await supabase.from("recurring_template_attachments").delete().in("id", insertedIds);
    }
    if (uploadedPaths.length > 0) {
      await supabase.storage.from("task-attachments").remove(uploadedPaths);
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

export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const attachmentId = searchParams.get("attachmentId");

  if (!attachmentId) {
    return Response.json({ error: "attachmentId is required" }, { status: 400 });
  }

  const supabase = serviceClient();
  const { data: attachment, error: fetchError } = await supabase
    .from("recurring_template_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .eq("template_id", id)
    .single();

  if (fetchError || !attachment) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  await supabase.storage.from("task-attachments").remove([attachment.storage_path]);

  const { error: deleteError } = await supabase
    .from("recurring_template_attachments")
    .delete()
    .eq("id", attachmentId);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
