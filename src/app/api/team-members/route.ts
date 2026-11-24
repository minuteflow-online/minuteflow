import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { requireClientOrgVaIds, isResponse, serviceClient } from "@/lib/clientAdminAccess";

export const dynamic = "force-dynamic";

/**
 * GET: Return active admin/broad-access + VA profiles for recipient selection.
 * Pass ?all=true to return every active team member regardless of role (used by
 * the Team workload view, which shows the whole team, not just staff).
 */
export async function GET(request: Request) {
  // Bearer-token fallback for the desktop app — see project-messages/route.ts's
  // identical comment and PR #167.
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const supabase = await createClient(bearerToken);
  const {
    data: { user },
  } = await supabase.auth.getUser(bearerToken);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // A client (employer) gets their own org's active VAs only, with work
  // fields — never pay type or budget limits. The staff screens they reuse
  // (Assignment, Calendar) build their VA lists from this.
  if (user.app_metadata?.account_type === "client") {
    const auth = await requireClientOrgVaIds();
    if (isResponse(auth)) return auth;
    if (auth.vaIds.length === 0) return Response.json({ members: [] });
    const { data: orgVas, error: orgError } = await serviceClient()
      .from("profiles")
      .select("id, full_name, username, avatar_url, position, role, work_days, shift_hours, shift_start, shift_end")
      .in("id", auth.vaIds)
      .order("full_name");
    if (orgError) return Response.json({ error: orgError.message }, { status: 500 });
    return Response.json({ members: orgVas ?? [] });
  }

  const includeAll = new URL(request.url).searchParams.get("all") === "true";

  const { data: members, error } = await supabase
    .from("profiles")
    // Shift fields ride along so the Calendar can show a day's remaining budget
    // against what's already blocked — see shiftHoursFromProfile.
    .select("id, full_name, username, avatar_url, position, role, pay_rate_type, can_see_available_tasks, work_days, shift_hours, shift_start, shift_end, weekly_budget_limit, monthly_budget_limit")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filteredMembers = includeAll
    ? (members || [])
    : (members || []).filter((member) => member.role === "va" || hasBroadAdminAccess(member));

  return Response.json({ members: filteredMembers });
}
