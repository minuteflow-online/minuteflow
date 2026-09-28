import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Bearer-token fallback for the desktop app — see project-messages/route.ts's
// identical comment and PR #167.
async function requireMember(request: Request, id: string) {
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const supabase = await createClient(bearerToken);
  const { data: { user } } = await supabase.auth.getUser(bearerToken);
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
 * PATCH /api/conversations/[id]
 * body: { archived: boolean }
 * Archiving is per-viewer — it hides the conversation from your own list
 * (conversation_members.archived_at) without touching anyone else's. Unlike
 * delete, this is never destructive, so no membership-beyond-yourself rule
 * is needed.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const auth = await requireMember(request, id);
  if ("error" in auth) return auth.error;
  const { user, admin } = auth;

  const b = (await request.json()) as { archived?: boolean };
  if (typeof b.archived !== "boolean") return Response.json({ error: "archived (boolean) is required" }, { status: 400 });

  const { error } = await admin
    .from("conversation_members")
    .update({ archived_at: b.archived ? new Date().toISOString() : null })
    .eq("conversation_id", id)
    .eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/conversations/[id]
 * Soft delete (conversations.deleted_at) — removes the whole conversation
 * for every member, not just the caller. Any member may do this (a DM has no
 * single "owner" the way a General topic has an author); the messages
 * themselves are left in place, just no longer reachable through the normal
 * list or thread routes.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const auth = await requireMember(request, id);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { error } = await admin
    .from("conversations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
