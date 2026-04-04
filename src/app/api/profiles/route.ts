import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/profiles
 * List profiles, optionally filtered by role and active status.
 *  ?role=va       → only VAs
 *  ?active=true   → only active profiles
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const active = searchParams.get("active");

  let query = supabase
    .from("profiles")
    .select("id, username, full_name, role, department, position, is_active")
    .order("full_name");

  if (role) {
    query = query.eq("role", role);
  }
  if (active === "true") {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ profiles: data ?? [] });
}
