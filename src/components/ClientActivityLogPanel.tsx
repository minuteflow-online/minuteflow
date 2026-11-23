"use client";

import { useEffect, useState } from "react";
import ActivityLog from "@/components/ActivityLog";
import { createClient } from "@/lib/supabase/client";
import type { TimeLog, Profile } from "@/types/database";

// Same window the admin/VA dashboard's own Activity Log uses.
const ACTIVITY_LOOKBACK_DAYS = 14;
function activityLogFloorIso(): string {
  return new Date(Date.now() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

const noop = () => {};

export default function ClientActivityLogPanel() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [viewerId, setViewerId] = useState<string>("");
  const [orgTimezone, setOrgTimezone] = useState("UTC");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        // Names + timezone come from the server: a client can't read other
        // people's profiles (or the company settings) directly.
        const [contextRes, userResult, logsResult] = await Promise.all([
          fetch("/api/client-admin/team-context", { cache: "no-store" }),
          supabase.auth.getUser(),
          supabase
            .from("time_logs")
            .select("*")
            .gte("start_time", activityLogFloorIso())
            .order("start_time", { ascending: false }),
        ]);
        const context = contextRes.ok
          ? ((await contextRes.json()) as { timezone?: string; people?: Profile[] })
          : {};
        if (context.timezone) setOrgTimezone(context.timezone);
        setViewerId(userResult.data.user?.id ?? "");
        const rows = (logsResult.data ?? []) as TimeLog[];
        setLogs(rows);
        setProfiles(context.people ?? []);
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

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <p className="text-sm font-medium text-espresso">No activity yet</p>
        <p className="mt-1 text-xs text-stone">
          Your VAs' logged work will show up here once they start.
        </p>
      </div>
    );
  }

  return (
    <ActivityLog
      logs={logs}
      screenshots={{}}
      onAddScreenshot={noop}
      role="client"
      currentUserId={viewerId}
      profiles={profiles}
      timezone={orgTimezone}
      readOnly
    />
  );
}
