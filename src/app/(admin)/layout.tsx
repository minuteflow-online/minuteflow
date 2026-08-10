import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopNav from "@/components/TopNav";
import type { UserRole } from "@/types/database";

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

  // Check role — admins and staff whose Department is "IT" can access admin pages.
  // (Department is used instead of a dedicated role because the `profiles.role`
  // column has a DB check constraint limited to admin/manager/va.)
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, department")
    .eq("id", user.id)
    .single();

  const isITStaff = profile?.department?.trim().toUpperCase() === "IT";
  if (!profile || (profile.role !== "admin" && !isITStaff)) {
    redirect("/dashboard");
  }

  const fullName =
    profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Admin";
  const role: UserRole = profile.role || "admin";

  return (
    <>
      <TopNav user={{ full_name: fullName, role, department: profile.department }} />
      <main className="flex-1">{children}</main>
    </>
  );
}
