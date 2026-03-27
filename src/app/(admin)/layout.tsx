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

  // Check role — only admins can access admin pages
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const fullName =
    profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Admin";
  const role: UserRole = profile.role || "admin";

  return (
    <>
      <TopNav user={{ full_name: fullName, role }} />
      <main className="flex-1">{children}</main>
    </>
  );
}
