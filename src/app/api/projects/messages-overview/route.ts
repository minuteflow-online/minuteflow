import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

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
 * project_id, title, body, created_at, comment_count }] } — opening a thread
 * happens inside the objective's Message Board.
 */
export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (new URL(request.url).searchParams.get("projectIds") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return Response.json({ messages: [] });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("project_messages")
    .select(
      `id, project_id, title, body, category, created_at, author_id,
       project_message_comments(id, body, created_at, author_id, author:profiles!project_message_comments_author_id_fkey(full_name, username))`
    )
    .in("project_id", ids)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type RawComment = { id: number; body: string; created_at: string; author_id: string | null; author?: { full_name?: string; username?: string } | null };
  const messages = (data ?? []).map((m) => {
    const raw = (Array.isArray(m.project_message_comments) ? m.project_message_comments : []) as RawComment[];
    const comments = raw
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((c) => ({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author_id: c.author_id,
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

  return Response.json({ messages });
}
