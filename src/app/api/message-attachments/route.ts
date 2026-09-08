import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import {
  canAccessMessageTarget,
  fetchAttachmentsFor,
  messageAttachmentStoragePath,
  MESSAGE_ATTACHMENT_BUCKET,
  MESSAGE_ATTACHMENT_SELECT,
  type MessageAttachmentTargetType,
} from "@/lib/messageAttachments";

export const dynamic = "force-dynamic";

/** Matches the task-attachments bucket's own ceiling. */
const MAX_FILE_BYTES = 52428800;
const TARGET_TYPES: MessageAttachmentTargetType[] = [
  "project_message",
  "project_message_comment",
  "direct_message",
];

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

function parseTargetType(raw: string | null): MessageAttachmentTargetType | null {
  return TARGET_TYPES.includes(raw as MessageAttachmentTargetType) ? (raw as MessageAttachmentTargetType) : null;
}

/**
 * GET /api/message-attachments?targetType=<project_message|project_message_comment|direct_message>&targetId=<id>
 * Every attachment (file or link) on one topic, reply, or DM.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;

  const { searchParams } = new URL(request.url);
  const targetType = parseTargetType(searchParams.get("targetType"));
  const targetId = searchParams.get("targetId");
  if (!targetType || !targetId) {
    return Response.json({ error: "targetType and targetId are required" }, { status: 400 });
  }

  const admin = serviceClient();
  if (!(await canAccessMessageTarget(admin, profile, user.id, targetType, targetId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const attachments = await fetchAttachmentsFor(admin, targetType, targetId);
  return Response.json({ attachments });
}

/**
 * POST /api/message-attachments
 * multipart/form-data { file, targetType, targetId }  → uploads a file
 * application/json    { targetType, targetId, kind: "link", url } → attaches a link
 *
 * Same access rule as posting to the target itself — attaching isn't looser
 * than replying.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const admin = serviceClient();

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      targetType?: string;
      targetId?: string;
      url?: string;
    };
    const targetType = parseTargetType(body.targetType ?? null);
    const targetId = body.targetId?.trim();
    const url = body.url?.trim();
    if (!targetType || !targetId) {
      return Response.json({ error: "targetType and targetId are required" }, { status: 400 });
    }
    if (!url) return Response.json({ error: "url is required" }, { status: 400 });
    try {
      // new URL() rejects anything that isn't a well-formed absolute URL —
      // "google.com" with no scheme included, same as the plain <input> Link
      // field elsewhere (TaskEditor, SubmitWorkModal) expects "https://...".
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("not http(s)");
    } catch {
      return Response.json({ error: "Enter a full link starting with https://" }, { status: 400 });
    }

    if (!(await canAccessMessageTarget(admin, profile, user.id, targetType, targetId))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await admin
      .from("message_attachments")
      .insert({ target_type: targetType, target_id: targetId, kind: "link", url, uploaded_by: user.id })
      .select(MESSAGE_ATTACHMENT_SELECT)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ attachment: { ...data, signedUrl: null } }, { status: 201 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const targetType = parseTargetType(formData.get("targetType") as string | null);
  const targetId = (formData.get("targetId") as string | null)?.trim();
  const file = formData.get("file");
  if (!targetType || !targetId) {
    return Response.json({ error: "targetType and targetId are required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  if (!(await canAccessMessageTarget(admin, profile, user.id, targetType, targetId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const storagePath = messageAttachmentStoragePath(targetType, targetId, file.name);
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(MESSAGE_ATTACHMENT_BUCKET)
    .upload(storagePath, arrayBuffer, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) return Response.json({ error: uploadError.message }, { status: 500 });

  const { data, error } = await admin
    .from("message_attachments")
    .insert({
      target_type: targetType,
      target_id: targetId,
      kind: "file",
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: user.id,
    })
    .select(MESSAGE_ATTACHMENT_SELECT)
    .single();

  if (error) {
    await admin.storage.from(MESSAGE_ATTACHMENT_BUCKET).remove([storagePath]);
    return Response.json({ error: error.message }, { status: 400 });
  }

  const { data: signedData } = await admin.storage.from(MESSAGE_ATTACHMENT_BUCKET).createSignedUrl(storagePath, 3600);
  return Response.json({ attachment: { ...data, signedUrl: signedData?.signedUrl ?? null } }, { status: 201 });
}

/**
 * DELETE /api/message-attachments?id=<uuid>
 * Whoever uploaded it, or an admin — same rule as deleting a comment.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const isAdmin = hasBroadAdminAccess(profile);
  const admin = serviceClient();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { data: existing } = await admin
    .from("message_attachments")
    .select("id, uploaded_by, storage_path, kind")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return Response.json({ error: "Attachment not found" }, { status: 404 });
  if (!isAdmin && existing.uploaded_by !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existing.kind === "file" && existing.storage_path) {
    await admin.storage.from(MESSAGE_ATTACHMENT_BUCKET).remove([existing.storage_path]);
  }
  const { error } = await admin.from("message_attachments").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return new Response(null, { status: 204 });
}
