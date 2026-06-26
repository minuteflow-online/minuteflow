import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Return active admin + VA profiles for recipient selection */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: members, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, position, role")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filteredMembers = (members || []).filter(
    (member) => member.role === "admin" || member.role === "va"
  );

  return Response.json({ members: filteredMembers });
}
