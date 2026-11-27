import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClientTopNav from "@/components/ClientTopNav";
import ClientMainFrame from "@/components/ClientMainFrame";
import { ToastProvider } from "@/contexts/ToastProvider";

export default async function ClientLayout({
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, avatar_url, organization_id")
    .eq("id", user.id)
    .single();

  // This view is for clients only — everyone else belongs in the staff app.
  if (profile?.role !== "client") {
    redirect("/dashboard");
  }

  // Shown under the name in the top bar, the way staff see their role.
  const { data: org } = profile.organization_id
    ? await supabase.from("organizations").select("owner_profile_id").eq("id", profile.organization_id).maybeSingle()
    : { data: null };
  const roleLabel = org?.owner_profile_id === user.id ? "Team owner" : "Co-admin";

  const fullName = profile.full_name || user.email?.split("@")[0] || "Client";

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <ClientTopNav fullName={fullName} avatarUrl={profile.avatar_url ?? null} roleLabel={roleLabel} />
        <ClientMainFrame>{children}</ClientMainFrame>
      </div>
    </ToastProvider>
  );
}
