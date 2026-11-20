import { createClient } from "@/lib/supabase/server";
import ClientTeamPanel from "@/components/ClientTeamPanel";
import ClientAssignedTasksPanel from "@/components/ClientAssignedTasksPanel";
import ClientBoardPanel from "@/components/ClientBoardPanel";
import ClientActivityLogPanel from "@/components/ClientActivityLogPanel";
import ClientMessagesPanel from "@/components/ClientMessagesPanel";
import ClientQuickPickPanel from "@/components/ClientQuickPickPanel";

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

      {/* Same 3-column shape as the main MinuteFlow dashboard — Messages,
          then the flexible middle column, then Quick Pick + Team on the
          right — just scoped to this client's own org instead of the
          whole company. */}
      <div className="grid gap-5 grid-cols-1 md:grid-cols-[1fr_280px] lg:grid-cols-[300px_1fr_280px]">
        <ClientMessagesPanel />
        <ClientAssignedTasksPanel />
        <div className="space-y-5">
          <ClientQuickPickPanel />
          <ClientTeamPanel />
        </div>
      </div>

      <ClientActivityLogPanel />
      <ClientBoardPanel />
    </div>
  );
}
