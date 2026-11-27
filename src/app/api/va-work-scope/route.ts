import { createClient } from "@/lib/supabase/server";
import { serviceClient, vaWorkScope } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/va-work-scope — the signed-in VA's own work scope: whether they
 * work only for a client (joined through a client's VA invite) and which
 * client teams they're on. The dashboard uses it to hide agency-only choices
 * (agency Quick Pick actions, agency accounts) from a client-only VA. Only
 * ever answers about the caller.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await vaWorkScope(serviceClient(), user.id);
  return Response.json(scope);
}
