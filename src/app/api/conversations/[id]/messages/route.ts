import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function requireMember(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = serviceClient();
  const { data: member } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: Response.json({ error: "You're not in this conversation" }, { status: 403 }) };
  return { user, admin };
}

/**
 * GET /api/conversations/[id]/messages
 * Messages oldest→newest for a conversation the caller is in. Marks it read.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const auth = await requireMember(id);
  if ("error" in auth) return auth.error;
  const { user, admin } = auth;

  const { data, error } = await admin
    .from("direct_messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const senderIds = Array.from(new Set((data ?? []).map((m) => m.sender_id as string)));
  const nameById = new Map<string, { name: string; avatar_url: string | null }>();
  if (senderIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, username, avatar_url").in("id", senderIds);
    for (const p of profs ?? []) nameById.set(p.id as string, { name: (p.full_name as string) || (p.username as string) || "?", avatar_url: (p.avatar_url as string | null) ?? null });
  }

  // Mark read.
  await admin.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", id).eq("user_id", user.id);

  const messages = (data ?? []).map((m) => ({
    id: m.id as number,
    body: m.body as string,
    created_at: m.created_at as string,
    sender_id: m.sender_id as string,
    mine: m.sender_id === user.id,
    sender_name: nameById.get(m.sender_id as string)?.name ?? "?",
  }));
  return Response.json({ messages });
}

/**
 * POST /api/conversations/[id]/messages
 * body: { body }. Sends a message and notifies the other members (bell + Telegram).
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const auth = await requireMember(id);
  if ("error" in auth) return auth.error;
  const { user, admin } = auth;

  const b = (await request.json()) as { body?: string };
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!body) return Response.json({ error: "Message can't be empty" }, { status: 400 });

  const { data: msg, error } = await admin
    .from("direct_messages")
    .insert({ conversation_id: id, sender_id: user.id, body })
    .select("id, created_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);

  // Notify the other members.
  const [{ data: me }, { data: conv }, { data: members }] = await Promise.all([
    admin.from("profiles").select("full_name, username").eq("id", user.id).single(),
    admin.from("conversations").select("is_group, title").eq("id", id).single(),
    admin.from("conversation_members").select("user_id").eq("conversation_id", id),
  ]);
  const senderName = me?.full_name || me?.username || "Someone";
  const where = conv?.is_group && conv?.title ? ` in ${conv.title}` : "";
  const snippet = body.length > 160 ? `${body.slice(0, 160)}…` : body;
  for (const m of members ?? []) {
    if ((m.user_id as string) === user.id) continue;
    await notifyOne(admin, {
      targetUserId: m.user_id as string,
      senderId: user.id,
      content: `${senderName}${where}: ${snippet}`,
      telegram: `💬 <b>${esc(senderName)}</b>${where ? ` <i>${esc(where.trim())}</i>` : ""}\n\n${esc(snippet)}`,
      topic: "message",
    });
  }

  return Response.json({ message: { id: msg.id, body, created_at: msg.created_at, mine: true, sender_id: user.id, sender_name: senderName } }, { status: 201 });
}
