import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

/**
 * GET: Return active admin/broad-access + VA profiles for recipient selection.
 * Pass ?all=true to return every active team member regardless of role (used by
 * the Team workload view, which shows the whole team, not just staff).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const includeAll = new URL(request.url).searchParams.get("all") === "true";

  const { data: members, error } = await supabase
    .from("profiles")
    // Shift fields ride along so the Calendar can show a day's remaining budget
    // against what's already blocked — see shiftHoursFromProfile.
    .select("id, full_name, username, position, role, pay_rate_type, can_see_available_tasks, work_days, shift_hours, shift_start, shift_end, weekly_budget_limit, monthly_budget_limit")
    .eq("is_active", true)
    .order("full_name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const filteredMembers = includeAll
    ? (members || [])
    : (members || []).filter((member) => member.role === "va" || hasBroadAdminAccess(member));

  return Response.json({ members: filteredMembers });
}
