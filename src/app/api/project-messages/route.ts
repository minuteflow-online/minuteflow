import { createClient } from "@/lib/supabase/server";
import { canAccessProject, serviceClient } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

const authorSelect = "id, full_name, username, avatar_url";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, profile };
}

/**
 * GET /api/project-messages?projectId=<uuid>
 * List posts (newest first) for one Operation/Objective, each with its
 * comments and author profile. Access gated by canAccessProject — same rule
 * every project-scoped surface uses.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

  const supabase = serviceClient();
  if (!(await canAccessProject(supabase, profile, user.id, projectId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("project_messages")
    .select(
      `id, project_id, author_id, title, body, category, pinned, created_at, updated_at,
       author:profiles!project_messages_author_id_fkey(${authorSelect}),
       project_message_comments(id, body, author_id, created_at,
         author:profiles!project_message_comments_author_id_fkey(${authorSelect}))`
    )
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Drop soft-deleted comments and sort each post's thread oldest-first,
  // without a second round trip.
  const messages = (data ?? []).map((m) => ({
    ...m,
    project_message_comments: (m.project_message_comments ?? [])
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  }));

  return Response.json({ messages });
}

/**
 * POST /api/project-messages
 * body: { project_id, title, body, category? }
 * Posting is limited to the same canAccessProject rule as reading — the
 * project's assigned VAs, its creator, and admins.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;

  const body = (await request.json()) as {
    project_id?: string;
    title?: string;
    body?: string;
    category?: string | null;
  };
  const projectId = body.project_id;
  const title = body.title?.trim();
  const content = body.body?.trim();
  if (!projectId) return Response.json({ error: "project_id is required" }, { status: 400 });
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (!content) return Response.json({ error: "body is required" }, { status: 400 });

  const supabase = serviceClient();
  if (!(await canAccessProject(supabase, profile, user.id, projectId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("project_messages")
    .insert({
      project_id: projectId,
      author_id: user.id,
      title,
      body: content,
      category: body.category?.trim() || null,
    })
    .select(`id, project_id, author_id, title, body, category, pinned, created_at, updated_at, author:profiles!project_messages_author_id_fkey(${authorSelect})`)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ message: { ...data, project_message_comments: [] } }, { status: 201 });
}

/**
 * PATCH /api/project-messages?id=<uuid>
 * body: { title?, body?, category?, pinned? }
 * Author may edit their own post; admins may edit or pin any post. Pinning
 * specifically is admin-only — a VA can't pin their own post to the top.
 */
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const { hasBroadAdminAccess } = await import("@/lib/financialAccess");
  const isAdmin = hasBroadAdminAccess(profile);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("project_messages")
    .select("author_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return Response.json({ error: "Message not found" }, { status: 404 });
  if (!isAdmin && existing.author_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    title?: string;
    body?: string;
    category?: string | null;
    pinned?: boolean;
  };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.body !== undefined) updates.body = body.body.trim();
  if (body.category !== undefined) updates.category = body.category?.trim() || null;
  if (body.pinned !== undefined) {
    if (!isAdmin) return Response.json({ error: "Only admins can pin a post" }, { status: 403 });
    updates.pinned = Boolean(body.pinned);
  }

  const { data, error } = await supabase
    .from("project_messages")
    .update(updates)
    .eq("id", id)
    .select(`id, project_id, author_id, title, body, category, pinned, created_at, updated_at, author:profiles!project_messages_author_id_fkey(${authorSelect})`)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ message: data });
}

/**
 * DELETE /api/project-messages?id=<uuid>
 * Soft delete (deleted_at), same author-or-admin rule as PATCH. Comments
 * stay in place — only the parent post disappears from GET's is("deleted_at",
 * null) filter.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user, profile } = auth;
  const { hasBroadAdminAccess } = await import("@/lib/financialAccess");
  const isAdmin = hasBroadAdminAccess(profile);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("project_messages")
    .select("author_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return Response.json({ error: "Message not found" }, { status: 404 });
  if (!isAdmin && existing.author_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("project_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
