import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopNav from "@/components/TopNav";
import type { UserRole } from "@/types/database";
import { hasAdminPanelAccess } from "@/lib/financialAccess";
import { ToastProvider } from "@/contexts/ToastProvider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check role — Admin, Manager, Specialist, and Founder/CEO/Accounting (see
  // hasAdminPanelAccess in financialAccess.ts), plus VAs granted a specific
  // admin permission (see adminPermissions.ts), can access admin pages.
  // Coordinator is deliberately excluded here even though it gets broad
  // Insights/Productivity visibility elsewhere (hasBroadAdminAccess) — the
  // admin panel itself is a narrower tier.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department, admin_permissions, avatar_url")
    .eq("id", user.id)
    .single();

  const hasAnyAdminPermission = (profile?.admin_permissions?.length ?? 0) > 0;
  if (!profile || (!hasAdminPanelAccess(profile) && !hasAnyAdminPermission)) {
    redirect("/dashboard");
  }

  const fullName =
    profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Admin";
  const role: UserRole = profile.role || "admin";

  return (
    <ToastProvider>
      <TopNav user={{ full_name: fullName, role, department: profile.department, admin_permissions: profile.admin_permissions, avatar_url: profile.avatar_url }} />
      <main className="flex-1">{children}</main>
    </ToastProvider>
  );
}
