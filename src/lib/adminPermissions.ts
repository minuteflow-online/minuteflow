// Granular admin-panel access for a plain role="va" account, independent of
// `role` and the DB's `is_admin_or_manager()`/RLS layer. Toni's own words on
// why this is a separate mechanism rather than reusing role="manager": role
// carries real financial/payroll consequences she isn't ready to introduce
// as a side effect of a permission toggle, and granting access must never
// automatically change what `role` an account holds.
//
// Financials/Invoices/Paystubs are never represented here and must never be
// added to this list — those stay hard-locked to Founder/Accounting
// financial access (see src/lib/financialAccess.ts), everywhere they're
// checked.

import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const ADMIN_PERMISSION_BUNDLES = [
  {
    key: "task_management",
    label: "Task Management",
    description: "Task Assignments and Output Based Tasks tabs in the admin panel.",
  },
] as const;

export type AdminPermissionBundle = (typeof ADMIN_PERMISSION_BUNDLES)[number]["key"];

/**
 * True if `profile` should be treated as admin-equivalent for `bundle`.
 * Anyone with broad admin-panel access (Admin, Manager, Coordinator,
 * Specialist, CEO, Founder — see hasBroadAdminAccess) always passes, for
 * every bundle. Everyone else (plain role="va") needs `bundle` explicitly
 * present in their admin_permissions grant.
 */
export function hasAdminPermission(
  profile: { role?: string | null; admin_permissions?: string[] | null } | null | undefined,
  bundle: AdminPermissionBundle
): boolean {
  if (!profile) return false;
  if (hasBroadAdminAccess(profile)) return true;
  return Boolean(profile.admin_permissions?.includes(bundle));
}
