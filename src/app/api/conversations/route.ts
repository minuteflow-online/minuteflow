import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

/**
 * GET /api/conversations
 * The user's DM + group conversations, newest activity first, each with its
 * members, last message, and unread count (messages after the user's
 * last_read_at that they didn't send).
 */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const supabase = serviceClient();

  const { data: mine } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);
  const convIds = (mine ?? []).map((m) => m.conversation_id as string);
  const lastReadBy = new Map<string, string | null>((mine ?? []).map((m) => [m.conversation_id as string, m.last_read_at as string | null]));
  if (convIds.length === 0) return Response.json({ conversations: [] });

  const [{ data: convs }, { data: allMembers }, { data: msgs }] = await Promise.all([
    supabase.from("conversations").select("id, is_group, title, created_by, updated_at").in("id", convIds),
    supabase.from("conversation_members").select("conversation_id, user_id").in("conversation_id", convIds),
    supabase.from("direct_messages").select("conversation_id, sender_id, body, created_at").in("conversation_id", convIds).order("created_at", { ascending: false }).limit(2000),
  ]);

  // Resolve member profile names.
  const memberIds = Array.from(new Set((allMembers ?? []).map((m) => m.user_id as string)));
  const nameById = new Map<string, string>();
  if (memberIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", memberIds);
    for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) || (p.username as string) || "?");
  }
  const membersByConv = new Map<string, { id: string; name: string }[]>();
  for (const m of allMembers ?? []) {
    const arr = membersByConv.get(m.conversation_id as string) ?? [];
    arr.push({ id: m.user_id as string, name: nameById.get(m.user_id as string) ?? "?" });
    membersByConv.set(m.conversation_id as string, arr);
  }

  // Last message + unread count per conversation.
  const lastMsg = new Map<string, { body: string; created_at: string; sender_id: string }>();
  const unread = new Map<string, number>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    if (!lastMsg.has(cid)) lastMsg.set(cid, { body: m.body as string, created_at: m.created_at as string, sender_id: m.sender_id as string });
    const lr = lastReadBy.get(cid);
    if (m.sender_id !== user.id && (!lr || (m.created_at as string) > lr)) unread.set(cid, (unread.get(cid) ?? 0) + 1);
  }

  const conversations = (convs ?? [])
    .map((c) => {
      const members = (membersByConv.get(c.id as string) ?? []).filter((m) => m.id !== user.id);
      const lm = lastMsg.get(c.id as string) ?? null;
      const title = c.is_group ? (c.title as string) || members.map((m) => m.name).join(", ") || "Group" : (members[0]?.name ?? "Conversation");
      return {
        id: c.id as string,
        is_group: c.is_group as boolean,
        title,
        members,
        last_message: lm ? { body: lm.body, created_at: lm.created_at, mine: lm.sender_id === user.id } : null,
        unread: unread.get(c.id as string) ?? 0,
        updated_at: c.updated_at as string,
      };
    })
    .sort((a, b) => (b.last_message?.created_at ?? b.updated_at).localeCompare(a.last_message?.created_at ?? a.updated_at));

  return Response.json({ conversations });
}

/**
 * POST /api/conversations
 * body: { member_ids: string[], title?, is_group? }
 * Start (or, for a 1:1, reuse) a conversation. The caller is always a member.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  const b = (await request.json()) as { member_ids?: unknown; title?: unknown; is_group?: unknown };
  const others = Array.isArray(b.member_ids) ? Array.from(new Set((b.member_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x !== user.id))) : [];
  if (others.length === 0) return Response.json({ error: "Pick at least one person" }, { status: 400 });
  const isGroup = Boolean(b.is_group) || others.length > 1;
  const memberIds = [user.id, ...others];

  const supabase = serviceClient();

  // Reuse an existing 1:1 with exactly these two people.
  if (!isGroup && others.length === 1) {
    const { data: myConvs } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", user.id);
    const ids = (myConvs ?? []).map((m) => m.conversation_id as string);
    if (ids.length) {
      const { data: pairs } = await supabase.from("conversation_members").select("conversation_id, user_id").in("conversation_id", ids);
      const byConv = new Map<string, Set<string>>();
      for (const p of pairs ?? []) { const s = byConv.get(p.conversation_id as string) ?? new Set(); s.add(p.user_id as string); byConv.set(p.conversation_id as string, s); }
      const { data: groupFlags } = await supabase.from("conversations").select("id, is_group").in("id", ids);
      const isG = new Map((groupFlags ?? []).map((g) => [g.id as string, g.is_group as boolean]));
      for (const [cid, set] of byConv) {
        if (!isG.get(cid) && set.size === 2 && set.has(user.id) && set.has(others[0])) {
          return Response.json({ conversation_id: cid, existing: true });
        }
      }
    }
  }

  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ is_group: isGroup, title: typeof b.title === "string" && b.title.trim() ? b.title.trim() : null, created_by: user.id })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });

  const { error: memErr } = await supabase.from("conversation_members").insert(memberIds.map((uid) => ({ conversation_id: conv.id, user_id: uid })));
  if (memErr) return Response.json({ error: memErr.message }, { status: 400 });

  return Response.json({ conversation_id: conv.id, existing: false }, { status: 201 });
}
