import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { remindPendingBroadcast } from "@/lib/broadcastReminders";

export const dynamic = "force-dynamic";

/**
 * POST: Remind everyone a published broadcast is for who hasn't acknowledged it
 * yet — bell notification plus a private Telegram DM, each linking to the broadcast.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { broadcast_id } = await request.json();
  if (!broadcast_id) return Response.json({ error: "broadcast_id is required" }, { status: 400 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: broadcast } = await admin
    .from("broadcasts")
    .select("id, title, category, status, require_word")
    .eq("id", broadcast_id)
    .single();
  if (!broadcast) return Response.json({ error: "Broadcast not found" }, { status: 404 });
  if (broadcast.status !== "published") {
    return Response.json({ error: "Only published broadcasts can be reminded" }, { status: 400 });
  }

  const reminded = await remindPendingBroadcast(admin, broadcast, user.id);
  return Response.json({ reminded });
}
