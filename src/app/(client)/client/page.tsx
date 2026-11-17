import { createClient } from "@/lib/supabase/server";
import ClientTeamPanel from "@/components/ClientTeamPanel";
import ClientAssignedTasksPanel from "@/components/ClientAssignedTasksPanel";

export default async function ClientDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, organization_id")
    .eq("id", user!.id)
    .single();

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile?.organization_id ?? "")
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-ink">
          Welcome, {profile?.full_name}
        </h2>
        <p className="mt-1 text-sm text-bark">{org?.name}</p>
      </div>

      <ClientTeamPanel />
      <ClientAssignedTasksPanel />
    </div>
  );
}
