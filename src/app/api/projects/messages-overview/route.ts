import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { fetchAttachmentsByTargets } from "@/lib/messageAttachments";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * GET /api/projects/messages-overview?projectIds=a,b,c
 * Recent message-board posts across the given objectives, newest first, for the
 * landing dashboard's Message Board card. Returns { messages: [{ id,
 * project_id, title, body, created_at, comment_count }], counts: { [project_id]:
 * number } } — opening a thread happens inside the objective's Message Board.
 * `counts` is a separate, unlimited query: `messages` is capped at 30 rows
 * across the whole requested scope, so counting client-side from that list
 * would undercount any scope with more posts than the cap.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ messages: [], counts: {} });

  const supabase = serviceClient();
  const [{ data, error }, { data: countRows, error: countError }] = await Promise.all([
    supabase
      .from("project_messages")
      .select(
        `id, project_id, title, body, category, created_at, author_id, edited_at,
         project_message_comments(id, body, created_at, edited_at, author_id, author:profiles!project_message_comments_author_id_fkey(full_name, username))`
      )
      .in("project_id", ids)
      // A trashed topic is soft-deleted, and this list never checked — so a topic
      // came straight back on the next refetch and looked undeletable.
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    // Unlimited, project_id-only — the per-tile count on the Overview card
    // needs the real total, not just how many happen to fit in the 30-row
    // feed above. Excludes the page-objective sentinel row (title
    // "__page_objective__"), same as the client already filters it out.
    supabase
      .from("project_messages")
      .select("project_id, title")
      .in("project_id", ids)
      .is("deleted_at", null)
      .is("archived_at", null),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (countError) return Response.json({ error: countError.message }, { status: 500 });

  const counts: Record<string, number> = {};
  for (const row of countRows ?? []) {
    if (row.title === "__page_objective__") continue;
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }

  type RawComment = { id: number; body: string; created_at: string; edited_at?: string | null; author_id: string | null; author?: { full_name?: string; username?: string } | null };
  const withComments = (data ?? []).map((m) => {
    const raw = (Array.isArray(m.project_message_comments) ? m.project_message_comments : []) as RawComment[];
    const comments = raw
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((c) => ({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author_id: c.author_id,
        edited_at: c.edited_at ?? null,
        author: c.author?.full_name || c.author?.username || "Someone",
      }));
    return {
      id: m.id,
      project_id: m.project_id,
      title: m.title,
      body: m.body,
      objective: (m as { category?: string | null }).category ?? null,
      created_at: m.created_at,
      author_id: m.author_id,
      comment_count: comments.length,
      comments,
    };
  });

  // Attachments, batched (one query per target type) rather than one per
  // topic/comment — same reasoning as /api/project-messages's own GET.
  const messageIds = withComments.map((m) => m.id);
  const commentIds = withComments.flatMap((m) => m.comments.map((c) => c.id));
  const [attachmentsByMessage, attachmentsByComment] = await Promise.all([
    fetchAttachmentsByTargets(supabase, "project_message", messageIds),
    fetchAttachmentsByTargets(supabase, "project_message_comment", commentIds),
  ]);

  const messages = withComments.map((m) => ({
    ...m,
    attachments: attachmentsByMessage.get(String(m.id)) ?? [],
    comments: m.comments.map((c) => ({ ...c, attachments: attachmentsByComment.get(String(c.id)) ?? [] })),
  }));

  return Response.json({ messages, counts });
}
