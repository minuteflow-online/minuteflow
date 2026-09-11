import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";
import { hasAdminPanelAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * Admin oversight of Personal messages (see DashboardMessagePanel's
 * "Personal" tab — conversations + direct_messages). Gated to the moderation
 * tier (Admin, Manager, CEO/Founder — same tier that already moderates
 * Requests/Feedback/Reviews), same as hasModerationAccess everywhere else.
 *
 * This route only lists conversations with their members and a last-message
 * preview — it never marks anything read and never touches
 * conversation_members, so an admin browsing the list leaves no trace for
 * the participants. Opening one conversation's actual messages is a
 * separate route (./[id]/messages) so the list itself stays cheap.
 */

async function loadCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isModerator: false };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  // TEMP FOR TESTING (2026-09-11, requested by Neil in chat): widened from
  // hasModerationAccess to hasAdminPanelAccess so a Specialist/IT account
  // can see and test this before it ships. Revert to hasModerationAccess
  // once confirmed working — matching TEMP comment in
  // src/app/(admin)/admin/page.tsx and ./[id]/messages/route.ts.
  return { user, isModerator: hasAdminPanelAccess(profile) };
}

/** GET — every conversation in the system, newest activity first. Moderation-tier only. */
export async function GET() {
  const { user, isModerator } = await loadCaller();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isModerator) return Response.json({ conversations: [], isModerator: false });

  const admin = serviceClient();

  const [{ data: convs }, { data: allMembers }, { data: msgs }] = await Promise.all([
    admin.from("conversations").select("id, is_group, title, created_by, updated_at").order("updated_at", { ascending: false }).limit(500),
    admin.from("conversation_members").select("conversation_id, user_id"),
    admin.from("direct_messages").select("conversation_id, sender_id, body, created_at").order("created_at", { ascending: false }).limit(4000),
  ]);

  const memberIds = Array.from(new Set((allMembers ?? []).map((m) => m.user_id as string)));
  const nameById = new Map<string, string>();
  if (memberIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, username").in("id", memberIds);
    for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) || (p.username as string) || "?");
  }

  const membersByConv = new Map<string, { id: string; name: string }[]>();
  for (const m of allMembers ?? []) {
    const arr = membersByConv.get(m.conversation_id as string) ?? [];
    arr.push({ id: m.user_id as string, name: nameById.get(m.user_id as string) ?? "?" });
    membersByConv.set(m.conversation_id as string, arr);
  }

  const lastMsg = new Map<string, { body: string; created_at: string }>();
  const messageCount = new Map<string, number>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    messageCount.set(cid, (messageCount.get(cid) ?? 0) + 1);
    if (!lastMsg.has(cid)) lastMsg.set(cid, { body: m.body as string, created_at: m.created_at as string });
  }

  const conversations = (convs ?? [])
    .map((c) => {
      const members = membersByConv.get(c.id as string) ?? [];
      const title = c.is_group ? (c.title as string) || members.map((m) => m.name).join(", ") || "Group" : members.map((m) => m.name).join(" & ") || "Conversation";
      const lm = lastMsg.get(c.id as string) ?? null;
      return {
        id: c.id as string,
        is_group: c.is_group as boolean,
        title,
        members,
        message_count: messageCount.get(c.id as string) ?? 0,
        last_message: lm,
        updated_at: c.updated_at as string,
      };
    })
    .sort((a, b) => (b.last_message?.created_at ?? b.updated_at).localeCompare(a.last_message?.created_at ?? a.updated_at));

  return Response.json({ conversations, isModerator: true });
}
