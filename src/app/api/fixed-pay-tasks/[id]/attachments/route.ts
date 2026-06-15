import { createClient } from "@/lib/supabase/server";
import type { FixedPayTaskAttachment } from "@/types/database";

export const dynamic = "force-dynamic";

const ATTACHMENT_SELECT = "id, filename, storage_path, file_size, mime_type, uploaded_by, uploaded_at";

async function requireAdminOrManager() {
  const supabase = await createClient();
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

  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) as Response };
  }

  return { supabase, userId: user.id };
}

type RouteContext = { params: Promise<{ id: string }> };

async function ensureTaskExists(supabase: Awaited<ReturnType<typeof createClient>>, taskId: number) {
  const { data, error } = await supabase.from("fixed_pay_tasks").select("id").eq("id", taskId).single();
  if (error || !data) {
    return false;
  }
  return true;
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
  const auth = await requireAdminOrManager();
  if ("error" in auth) return auth.error;

  const { supabase } = auth;
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

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
  const auth = await requireAdminOrManager();
  if ("error" in auth) return auth.error;

  const { supabase, userId } = auth;
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return Response.json({ error: "Invalid task id" }, { status: 400 });
  }

  const exists = await ensureTaskExists(supabase, taskId);
  if (!exists) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

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
