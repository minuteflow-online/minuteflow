import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/** GET: Return active admin/broad-access + VA profiles for recipient selection */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: members, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, position, role, pay_rate_type, can_see_available_tasks")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filteredMembers = (members || []).filter(
    (member) => member.role === "va" || hasBroadAdminAccess(member)
  );

  return Response.json({ members: filteredMembers });
}
