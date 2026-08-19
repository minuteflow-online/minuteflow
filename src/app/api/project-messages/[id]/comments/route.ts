import { createClient } from "@/lib/supabase/server";
import { canAccessProject, serviceClient } from "@/lib/projectAccess";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const authorSelect = "id, full_name, username, avatar_url";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

/**
 * POST /api/project-messages/[id]/comments
 * body: { body }
 * [id] is the parent project_messages row. Same canAccessProject rule as
 * the post itself — reading and replying share one gate.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const { id: messageId } = await params;

  const body = (await request.json()) as { body?: string };
  const content = body.body?.trim();
  if (!content) return Response.json({ error: "body is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: message } = await supabase
    .from("project_messages")
    .select("id, project_id")
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!message) return Response.json({ error: "Message not found" }, { status: 404 });

  if (!(await canAccessProject(supabase, profile, user.id, message.project_id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("project_message_comments")
    .insert({ message_id: messageId, author_id: user.id, body: content })
    .select(`id, message_id, author_id, body, created_at, author:profiles!project_message_comments_author_id_fkey(${authorSelect})`)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ comment: data }, { status: 201 });
}

/**
 * PATCH /api/project-messages/[id]/comments?commentId=<uuid>
 * body: { body }
 * Author-or-admin, same rule as delete.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const isAdmin = hasBroadAdminAccess(profile);
  await params;

  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) return Response.json({ error: "commentId is required" }, { status: 400 });

  const requestBody = (await request.json()) as { body?: string };
  const content = requestBody.body?.trim();
  if (!content) return Response.json({ error: "body is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("project_message_comments")
    .select("author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!existing) return Response.json({ error: "Comment not found" }, { status: 404 });
  if (!isAdmin && existing.author_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("project_message_comments")
    .update({ body: content })
    .eq("id", commentId)
    .select(`id, message_id, author_id, body, created_at, author:profiles!project_message_comments_author_id_fkey(${authorSelect})`)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ comment: data });
}

/**
 * DELETE /api/project-messages/[id]/comments?commentId=<uuid>
 * Soft delete, author-or-admin — same rule as deleting a post.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const isAdmin = hasBroadAdminAccess(profile);
  await params; // messageId isn't needed once we have the comment row itself

  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) return Response.json({ error: "commentId is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("project_message_comments")
    .select("author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!existing) return Response.json({ error: "Comment not found" }, { status: 404 });
  if (!isAdmin && existing.author_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("project_message_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
