import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * The bin behind Messages.
 *
 * Trashing a topic hides it from everyone — it is soft-deleted, so the row and
 * its replies are still there. This is the one place they can be read back, and
 * only an admin can do it.
 *
 * A non-admin gets an empty list and isAdmin:false rather than a 403, so the UI
 * can simply not offer the Trash view without having to ask a separate
 * "am I allowed" question first.
 */

function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function loadCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  return { user, isAdmin: hasBroadAdminAccess(profile) };
}

/** GET — every trashed topic, newest first. Admin only. */
export async function GET() {
  const { user, isAdmin } = await loadCaller();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin) return Response.json({ messages: [], isAdmin: false });

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("project_messages")
    .select("id, project_id, title, body, created_at, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ messages: data ?? [], isAdmin: true });
}

/** POST { id } — put a trashed topic back. Admin only. */
export async function POST(request: Request) {
  const { user, isAdmin } = await loadCaller();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await request.json().catch(() => ({ id: null }));
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = serviceClient();
  const { error } = await supabase
    .from("project_messages")
    .update({ deleted_at: null })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
