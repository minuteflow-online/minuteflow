import { createClient } from "@/lib/supabase/server";

// Department tags that grant financial visibility (Invoices, Paystubs, the
// Financial tab, pay rates) — deliberately independent of `role`, mirroring
// the existing `department === "IT"` carve-out already shipped for Neil.
// `role === "admin"` alone no longer implies financial access.
const FINANCIAL_DEPARTMENTS = ["founder", "accounting"];

// Department tags that grant broad (non-financial) admin-panel access on
// top of role === "admin" | "manager".
const BROAD_ACCESS_DEPARTMENTS = ["it", "project coordinator"];

function normalizeDept(department?: string | null) {
  return department?.trim().toLowerCase() ?? "";
}

export function hasFinancialAccess(profile?: { department?: string | null } | null): boolean {
  return FINANCIAL_DEPARTMENTS.includes(normalizeDept(profile?.department));
}

export function hasBroadAdminAccess(
  profile?: { role?: string | null; department?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  if (profile?.role === "admin" || profile?.role === "manager") return true;
  return BROAD_ACCESS_DEPARTMENTS.includes(normalizeDept(profile?.department));
}

// Accounts and Clients are billing-adjacent — Admin and Project Coordinator
// are deliberately excluded even though they get the rest of the broad
// tier. Only Manager and financial-access accounts (Founder/Accounting) see
// these two.
export function hasAccountsClientsAccess(
  profile?: { role?: string | null; department?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return profile?.role === "manager";
}

// VA Portal moderation capabilities (approving Requests, moderating
// Feedback, publishing Reviews, awarding Tokens, reviewing Bug Reports) —
// Admin and Manager only. Project Coordinator (and IT, unless also
// role === "manager") are deliberately excluded here, unlike the broader
// admin-panel tier.
export function hasModerationAccess(
  profile?: { role?: string | null; department?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return profile?.role === "admin" || profile?.role === "manager";
}

/** Server-route guard: verifies the caller is authenticated and has
 * financial access (Founder/Accounting department tag). Returns
 * `{ userId }` on success or a ready-to-return `Response` on failure. */
export async function requireFinancialAccess(): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();

  if (!hasFinancialAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return { userId: user.id };
}
