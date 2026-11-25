import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { broadcastPortalPath, canReadBroadcast, type BroadcastMember, type RecipientRow } from "@/lib/broadcasts";
import { notifyOne } from "@/lib/notifyOne";
import { esc } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Comments under a broadcast (Toni's call, 2026-11-25): anyone who can read the
// broadcast reads and posts them, and the author is notified of each new one.
// The table has RLS on with no policies, so every read and write goes through
// here, after the visibility check.

const MAX_LENGTH = 4000;
const MAX_IDS = 200;

type Viewer = { member: BroadcastMember; isAdmin: boolean };

function adminClient(): SupabaseClient {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, employment_type, position, pay_rate_type, department, is_active")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return {
    member: {
      id: user.id,
      role: profile.role,
      employment_type: profile.employment_type,
      position: profile.position,
      pay_rate_type: profile.pay_rate_type,
      is_active: profile.is_active !== false,
    },
    isAdmin: hasBroadAdminAccess(profile),
  };
}

type BroadcastRow = {
  id: string;
  title: string | null;
  category: string;
  status: string;
  scheduled_at: string | null;
  created_by: string | null;
  shared_with?: string[] | null;
};

/** The broadcasts among `ids` this viewer may read. */
async function readableBroadcasts(admin: SupabaseClient, ids: string[], viewer: Viewer): Promise<BroadcastRow[]> {
  if (ids.length === 0) return [];
  const { data: broadcasts } = await admin.from("broadcasts").select("*").in("id", ids);
  if (!broadcasts?.length) return [];
  const { data: recipients } = await admin
    .from("broadcast_recipients")
    .select("broadcast_id, recipient_type, recipient_value")
    .in("broadcast_id", ids);
  const rowsBy = new Map<string, RecipientRow[]>();
  (recipients || []).forEach((r) => {
    rowsBy.set(r.broadcast_id, [...(rowsBy.get(r.broadcast_id) ?? []), { type: r.recipient_type, value: r.recipient_value }]);
  });
  return (broadcasts as BroadcastRow[]).filter((b) =>
    canReadBroadcast(b, rowsBy.get(b.id) ?? [], viewer.member, viewer.isAdmin)
  );
}

/** GET ?ids=a,b,c → { comments: { [broadcastId]: Comment[] } }, oldest first. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = Array.from(
    new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  ).slice(0, MAX_IDS);

  const admin = adminClient();
  const readable = (await readableBroadcasts(admin, ids, viewer)).map((b) => b.id);
  const comments: Record<string, unknown[]> = {};
  readable.forEach((id) => (comments[id] = []));
  if (readable.length === 0) return Response.json({ comments });

  const { data: rows, error } = await admin
    .from("broadcast_comments")
    .select("id, broadcast_id, user_id, body, created_at")
    .in("broadcast_id", readable)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((rows || []).map((r) => r.user_id)));
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: people } = await admin.from("profiles").select("id, full_name, username").in("id", userIds);
    (people || []).forEach((p) => names.set(p.id, p.full_name || p.username || "Unknown"));
  }

  (rows || []).forEach((r) => {
    comments[r.broadcast_id].push({
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      author_name: names.get(r.user_id) ?? "Unknown",
      mine: r.user_id === viewer.member.id,
      can_delete: r.user_id === viewer.member.id || viewer.isAdmin,
    });
  });
  return Response.json({ comments });
}

/** POST { broadcast_id, body } → posts a comment and tells the broadcast's author. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json().catch(() => ({}));
  const broadcastId = typeof payload.broadcast_id === "string" ? payload.broadcast_id : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!broadcastId || !body) return Response.json({ error: "Write something first" }, { status: 400 });
  if (body.length > MAX_LENGTH) return Response.json({ error: "That comment is too long" }, { status: 400 });

  const admin = adminClient();
  const [broadcast] = await readableBroadcasts(admin, [broadcastId], viewer);
  if (!broadcast) return Response.json({ error: "Broadcast not found" }, { status: 404 });

  const { data: row, error } = await admin
    .from("broadcast_comments")
    .insert({ broadcast_id: broadcastId, user_id: viewer.member.id, body })
    .select("id, broadcast_id, body, created_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: me } = await admin.from("profiles").select("full_name, username").eq("id", viewer.member.id).single();
  const name = me?.full_name || me?.username || "Someone";

  // The author hears about every comment but their own.
  const authorId = broadcast.created_by;
  if (authorId && authorId !== viewer.member.id) {
    after(async () => {
      const title = broadcast.title || "a broadcast";
      const snippet = body.length > 140 ? `${body.slice(0, 140)}…` : body;
      await notifyOne(admin, {
        targetUserId: authorId,
        senderId: viewer.member.id,
        content: `${name} commented on “${title}”: ${snippet}`,
        telegram: `💬 <b>${esc(name)}</b> commented on <b>${esc(title)}</b>:\n${esc(snippet)}`,
        topic: "broadcast",
        linkPath: broadcastPortalPath(broadcast.category, broadcast.id),
      });
    });
  }

  return Response.json({
    comment: { ...row, author_name: name, mine: true, can_delete: true },
  });
}

/** DELETE ?id= → removes a comment. Your own, or any one if you're an admin who can see the broadcast. */
export async function DELETE(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const admin = adminClient();
  const { data: comment } = await admin
    .from("broadcast_comments")
    .select("id, broadcast_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!comment) return Response.json({ error: "Comment not found" }, { status: 404 });

  const [broadcast] = await readableBroadcasts(admin, [comment.broadcast_id], viewer);
  if (!broadcast) return Response.json({ error: "Comment not found" }, { status: 404 });
  if (comment.user_id !== viewer.member.id && !viewer.isAdmin) {
    return Response.json({ error: "You can only delete your own comments" }, { status: 403 });
  }

  const { error } = await admin.from("broadcast_comments").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
