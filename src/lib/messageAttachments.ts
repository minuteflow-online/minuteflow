import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessProject } from "@/lib/projectAccess";

/**
 * Shared plumbing for attachments (files and links) on the three message
 * surfaces in DashboardMessagePanel: General topics, their replies, and
 * Personal DMs. One table (message_attachments) rather than three, because
 * the three targets need the same shape and the same set of API routes —
 * project_messages.id (uuid) and direct_messages.id (bigint) can't share a
 * real foreign key anyway, so target_type/target_id costs nothing a per-type
 * table wouldn't have paid in a different form.
 */
export type MessageAttachmentTargetType =
  | "project_message"
  | "project_message_comment"
  | "direct_message";

export type MessageAttachmentRow = {
  id: string;
  target_type: MessageAttachmentTargetType;
  target_id: string;
  kind: "file" | "link";
  filename: string | null;
  storage_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

export type MessageAttachment = MessageAttachmentRow & { signedUrl: string | null };

export const MESSAGE_ATTACHMENT_SELECT =
  "id, target_type, target_id, kind, filename, storage_path, file_size, mime_type, url, uploaded_by, uploaded_at";

const BUCKET = "task-attachments";

/**
 * Can this user read/attach to this message, comment, or DM? Mirrors the
 * access rule the parent row's own POST already enforces (see
 * project-messages/[id]/comments and conversations/[id]/messages) —
 * attaching a file is not a looser action than replying to it.
 */
export async function canAccessMessageTarget(
  admin: SupabaseClient,
  profile: { role?: string | null } | null | undefined,
  userId: string,
  targetType: MessageAttachmentTargetType,
  targetId: string
): Promise<boolean> {
  if (targetType === "direct_message") {
    const { data: dm } = await admin
      .from("direct_messages")
      .select("conversation_id")
      .eq("id", targetId)
      .maybeSingle();
    if (!dm) return false;
    const { data: member } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("conversation_id", dm.conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(member);
  }

  let projectId: string | null | undefined;
  if (targetType === "project_message") {
    const { data: message } = await admin
      .from("project_messages")
      .select("project_id")
      .eq("id", targetId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!message) return false;
    projectId = message.project_id as string | null;
  } else {
    const { data: comment } = await admin
      .from("project_message_comments")
      .select("message_id")
      .eq("id", targetId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!comment) return false;
    const { data: message } = await admin
      .from("project_messages")
      .select("project_id")
      .eq("id", comment.message_id)
      .maybeSingle();
    if (!message) return false;
    projectId = message.project_id as string | null;
  }

  // A general topic (project_id null) is the whole-team board — same rule
  // GET/POST /api/project-messages already applies.
  if (!projectId) return true;
  return canAccessProject(admin, profile, userId, projectId);
}

/** Signed URL for one file attachment, null for a link (it has no storage object) or on error. */
async function signOne(admin: SupabaseClient, row: MessageAttachmentRow): Promise<string | null> {
  if (row.kind !== "file" || !row.storage_path) return null;
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Every attachment for one target, newest last (so they read in the order
 * they were added, same as the message thread itself).
 */
export async function fetchAttachmentsFor(
  admin: SupabaseClient,
  targetType: MessageAttachmentTargetType,
  targetId: string
): Promise<MessageAttachment[]> {
  const { data } = await admin
    .from("message_attachments")
    .select(MESSAGE_ATTACHMENT_SELECT)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("uploaded_at", { ascending: true });
  const rows = (data ?? []) as MessageAttachmentRow[];
  return Promise.all(rows.map(async (row) => ({ ...row, signedUrl: await signOne(admin, row) })));
}

/**
 * Attachments for a batch of targets of the same type, grouped by
 * target_id — for embedding into a list response (every topic, every
 * comment, every DM) without one round trip per row.
 */
export async function fetchAttachmentsByTargets(
  admin: SupabaseClient,
  targetType: MessageAttachmentTargetType,
  targetIds: Array<string | number>
): Promise<Map<string, MessageAttachment[]>> {
  const map = new Map<string, MessageAttachment[]>();
  const ids = Array.from(new Set(targetIds.map(String)));
  if (ids.length === 0) return map;

  const { data } = await admin
    .from("message_attachments")
    .select(MESSAGE_ATTACHMENT_SELECT)
    .eq("target_type", targetType)
    .in("target_id", ids)
    .order("uploaded_at", { ascending: true });
  const rows = (data ?? []) as MessageAttachmentRow[];

  for (const row of rows) {
    const signedUrl = await signOne(admin, row);
    const list = map.get(row.target_id) ?? [];
    list.push({ ...row, signedUrl });
    map.set(row.target_id, list);
  }
  return map;
}

/** Storage path for an uploaded file attachment, scoped by target so nothing collides across topics/comments/DMs. */
export function messageAttachmentStoragePath(
  targetType: MessageAttachmentTargetType,
  targetId: string,
  filename: string
): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `messages/${targetType}/${targetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
}

export { BUCKET as MESSAGE_ATTACHMENT_BUCKET };
