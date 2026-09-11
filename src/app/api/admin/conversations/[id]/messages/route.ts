import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { hasModerationAccess } from "@/lib/financialAccess";
import { fetchAttachmentsByTargets } from "@/lib/messageAttachments";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function requireModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role, department").eq("id", user.id).single();
  if (!hasModerationAccess(profile)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * GET /api/admin/conversations/[id]/messages
 * Read-only admin view of one conversation, oldest→newest. Unlike
 * /api/conversations/[id]/messages, the caller doesn't need to be a member —
 * moderation access is enough — and this deliberately never writes
 * conversation_members.last_read_at, so opening a conversation to review it
 * doesn't mark it read for the actual participants or clear their unread badge.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const auth = await requireModerator();
  if ("error" in auth) return auth.error;

  const admin = serviceClient();

  const { data: conv } = await admin.from("conversations").select("id, is_group, title").eq("id", id).maybeSingle();
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });

  const { data: memberRows } = await admin.from("conversation_members").select("user_id").eq("conversation_id", id);
  const memberIds = (memberRows ?? []).map((m) => m.user_id as string);
  const nameById = new Map<string, { name: string; avatar_url: string | null }>();
  if (memberIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, username, avatar_url").in("id", memberIds);
    for (const p of profs ?? []) nameById.set(p.id as string, { name: (p.full_name as string) || (p.username as string) || "?", avatar_url: (p.avatar_url as string | null) ?? null });
  }

  const { data, error } = await admin
    .from("direct_messages")
    .select("id, sender_id, body, created_at, edited_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const attachmentsByDm = await fetchAttachmentsByTargets(
    admin,
    "direct_message",
    (data ?? []).map((m) => m.id as number)
  );

  const messages = (data ?? []).map((m) => ({
    id: m.id as number,
    body: m.body as string,
    created_at: m.created_at as string,
    edited_at: (m.edited_at as string | null) ?? null,
    sender_id: m.sender_id as string,
    sender_name: nameById.get(m.sender_id as string)?.name ?? "?",
    attachments: attachmentsByDm.get(String(m.id)) ?? [],
  }));

  const members = memberIds.map((uid) => ({ id: uid, name: nameById.get(uid)?.name ?? "?", avatar_url: nameById.get(uid)?.avatar_url ?? null }));

  return Response.json({
    conversation: { id: conv.id as string, is_group: conv.is_group as boolean, title: conv.title as string | null, members },
    messages,
  });
}
