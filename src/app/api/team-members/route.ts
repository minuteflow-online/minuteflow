import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: Return active VA profiles for recipient selection (admin only) */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: members, error } = await supabase
    .from("profiles")
    .select("id, full_name, employment_type, role")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ members: members || [] });
}
