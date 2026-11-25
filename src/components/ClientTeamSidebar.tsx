"use client";

import { useEffect, useState } from "react";
import TeamSidebar from "@/components/TeamSidebar";
import type { Profile, Session, TimeLog } from "@/types/database";

type MonitorMember = {
  profile: { id: string; full_name: string | null };
  status: "live" | "personal" | "break" | "off";
  currentTask: string;
  todayLogs?: Array<{
    id: number;
    task_name: string;
    category: string | null;
    start_time: string;
    end_time: string | null;
    duration_ms: number | null;
  }>;
};

/**
 * The client dashboard's Your Team — the staff TeamSidebar itself, fed from
 * /api/client-admin/team-monitor. That route already hides anything a VA does
 * for another account (their task shows as "Working on another account", and
 * only this org's logs come back), so nothing agency-side reaches this view.
 */
export default function ClientTeamSidebar() {
  const [members, setMembers] = useState<MonitorMember[]>([]);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [monitor, ctx] = await Promise.all([
        fetch("/api/client-admin/team-monitor", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/client-admin/team-context", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (cancelled) return;
      setMembers((monitor.members ?? []) as MonitorMember[]);
      if (ctx.timezone) setTimezone(ctx.timezone as string);
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // TeamSidebar reads a session's active_task for status and the task line;
  // this builds one from the masked status rather than the raw session.
  const sidebarMembers = members.map((m) => {
    const activeTask =
      m.status === "break"
        ? { task_name: "On Break", category: "Break" }
        : m.status === "personal"
        ? { task_name: "Personal time", category: "Personal" }
        : m.status === "live"
        ? { task_name: m.currentTask }
        : null;
    return {
      profile: { id: m.profile.id, full_name: m.profile.full_name ?? "" } as unknown as Profile,
      session: (m.status === "off" ? null : { user_id: m.profile.id, clocked_in: true, active_task: activeTask }) as unknown as Session | null,
    };
  });

  const timeLogs = members.flatMap((m) =>
    (m.todayLogs ?? []).map((l) => ({ ...l, user_id: m.profile.id, duration_ms: l.duration_ms ?? 0 }))
  ) as unknown as TimeLog[];

  return <TeamSidebar members={sidebarMembers} timeLogs={timeLogs} timezone={timezone} />;
}
