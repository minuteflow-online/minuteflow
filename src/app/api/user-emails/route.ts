import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** GET: Fetch user emails (admin only) */
export async function GET() {
  // Verify admin
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch all auth users to get emails
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Map user_id -> email
  const emailMap: Record<string, string> = {};
  for (const u of authData.users) {
    if (u.email) {
      emailMap[u.id] = u.email;
    }
  }

  return Response.json({ emails: emailMap });
}
