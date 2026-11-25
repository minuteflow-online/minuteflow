import { createClient } from "@/lib/supabase/server";
import ClientTeamPanel from "@/components/ClientTeamPanel";
import ClientAssignedTasksPanel from "@/components/ClientAssignedTasksPanel";
import ClientBoardPanel from "@/components/ClientBoardPanel";
import ClientActivityLogPanel from "@/components/ClientActivityLogPanel";
import { Suspense } from "react";
import DashboardMessagePanel from "@/components/DashboardMessagePanel";
import ClientMessagingTimeToggle from "@/components/ClientMessagingTimeToggle";
import ClientQuickPickPanel from "@/components/ClientQuickPickPanel";
import ClientClockWidget from "@/components/ClientClockWidget";
import ClientChecklistPanel from "@/components/ClientChecklistPanel";

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
      <ClientClockWidget fullName={profile?.full_name ?? ""} orgName={org?.name ?? ""} />

      {/* Same 3-column shape as the main MinuteFlow dashboard — Messages,
          then the flexible middle column, then Quick Pick + Team on the
          right — just scoped to this client's own org instead of the
          whole company. */}
      <div className="grid gap-5 grid-cols-1 md:grid-cols-[1fr_280px] lg:grid-cols-[300px_1fr_280px]">
        {/* The same Messages panel the staff dashboard uses (General /
            Personal / Comments) — its routes scope a client to their own
            org: their objectives' threads, DMs with their own VAs, never the
            agency's General board. */}
        <div className="flex flex-col gap-2">
          <Suspense fallback={null}>
            <DashboardMessagePanel currentUserId={user!.id} />
          </Suspense>
          <ClientMessagingTimeToggle orgId={profile?.organization_id ?? null} />
        </div>
        <ClientAssignedTasksPanel />
        <div className="space-y-5">
          <ClientChecklistPanel />
          <ClientQuickPickPanel />
          <ClientTeamPanel />
        </div>
      </div>

      <ClientActivityLogPanel />
      <ClientBoardPanel />
    </div>
  );
}
