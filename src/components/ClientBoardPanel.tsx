"use client";

import { useEffect, useState } from "react";
import DashboardBoardView from "@/components/DashboardBoardView";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/database";

export default function ClientBoardPanel() {
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [rosterRes, tzResult, userResult] = await Promise.all([
          fetch("/api/organization-invites"),
          supabase.from("organization_settings").select("timezone").limit(1).single(),
          supabase.auth.getUser(),
        ]);
        setViewerId(userResult.data.user?.id ?? null);
        if (tzResult.data?.timezone) setOrgTimezone(tzResult.data.timezone);

        const rosterData = await rosterRes.json();
        interface MemberRow {
          status: "invited" | "active";
          va_id: string;
        }
        const activeVaIds = ((rosterData.members ?? []) as MemberRow[])
          .filter((m) => m.status === "active")
          .map((m) => m.va_id);

        if (activeVaIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("*")
            .in("id", activeVaIds);
          setTeamMembers((profiles ?? []) as Profile[]);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone">
        <div className="h-4 w-4 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
        Loading...
      </div>
    );
  }

  if (teamMembers.length === 0 || !viewerId) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No VAs yet</p>
        <p className="mt-1 text-xs text-stone">
          Invite a VA from Your Team above to see their board and calendar here.
        </p>
      </div>
    );
  }

  return (
    <DashboardBoardView
      userId={viewerId}
      isAdmin
      readOnly
      teamMembers={teamMembers}
      orgTimezone={orgTimezone}
    />
  );
}
