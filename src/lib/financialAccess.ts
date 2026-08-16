// Real database roles now back these tiers (profiles.role: admin, manager,
// va, coordinator, specialist, ceo, founder — see profiles_role_check and
// the RLS policies keyed on these values). "Staff" is a display label over
// the stored "va" value (see displayRole() in src/lib/utils.ts), not a
// separate role here. Department (Accounting/IT/Project Management/
// Leadership) is purely descriptive now — it grants no access on its own.

export function hasFinancialAccess(
  profile?: { role?: string | null; department?: string | null } | null
): boolean {
  if (profile?.role === "founder" || profile?.role === "ceo") return true;
  // A Specialist in the Accounting department (e.g. a bookkeeper/CPA) also
  // sees financials — Specialist alone (any other department) does not.
  return profile?.role === "specialist" && profile?.department?.trim().toLowerCase() === "accounting";
}

export function hasBroadAdminAccess(
  profile?: { role?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return (
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "coordinator" ||
    profile?.role === "specialist"
  );
}

// Reaching the /admin panel itself is narrower than hasBroadAdminAccess.
// Coordinator gets everything hasBroadAdminAccess implies elsewhere (viewing
// every VA in Insights/Productivity, editing time logs) but not the admin
// panel's Team Management / Task Assignments / moderation surface.
export function hasAdminPanelAccess(
  profile?: { role?: string | null; department?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return profile?.role === "admin" || profile?.role === "manager" || profile?.role === "specialist";
}

// Accounts and Clients are billing-adjacent — Admin and Coordinator are
// deliberately excluded even though they get the rest of the broad tier.
// Manager, Specialist, CEO, and Founder see these two.
export function hasAccountsClientsAccess(
  profile?: { role?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return profile?.role === "manager" || profile?.role === "specialist";
}

// VA Portal moderation capabilities (approving Requests, moderating
// Feedback, publishing Reviews, awarding Tokens, reviewing Bug Reports) —
// Admin and Manager only. Coordinator/Specialist are deliberately excluded
// here, unlike the broader admin-panel tier.
export function hasModerationAccess(
  profile?: { role?: string | null } | null
): boolean {
  if (hasFinancialAccess(profile)) return true;
  return profile?.role === "admin" || profile?.role === "manager";
}

// Changing anyone's role (Team Management's Role field, or setting a role
// other than Staff when creating a new user) is restricted to CEO and
// Founder specifically — narrower than hasFinancialAccess, which also
// admits an Accounting-department Specialist for financial visibility but
// not role-granting. A founder's own role is further restricted server-side
// to only be changeable by that same account (see /api/users PATCH).
export function canGrantRoles(
  profile?: { role?: string | null } | null
): boolean {
  return profile?.role === "ceo" || profile?.role === "founder";
}
