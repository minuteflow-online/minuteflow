"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Session, TimeLog, TaskScreenshot, UserRole } from "@/types/database";
import {
  formatDuration,
  getInitials,
  getAvatarColor,
  todayStart,
} from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────── */

type TeamMember = {
  profile: Profile;
  session: Session | null;
  todayHoursMs: number;
  todayTaskCount: number;
  todayScreenshots: number;
  currentTaskName: string | null;
  currentTaskMeta: string | null;
  status: "working" | "on-break" | "away";
  // Time allocation breakdown (ms)
  personalMs: number;
  sortingMs: number;
  taskMs: number;
  breakMs: number;
  // Today's logs for expandable task list
  todayLogs: TimeLog[];
};

/* ── Helpers ──────────────────────────────────────────────── */

function computePayable(hoursMs: number, rate: number, rateType: string): number {
  const hours = hoursMs / 3600000;
  if (rateType === "hourly") return hours * rate;
  if (rateType === "daily") return (hours / 8) * rate; // assume 8h workday
  return 0; // monthly doesn't compute from daily hours
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ── Page Component ───────────────────────────────────────── */

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  // Check role on mount and redirect VAs
  useEffect(() => {
    async function checkRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      const userRole = (profile?.role as UserRole) || "va";
      setRole(userRole);
      if (userRole === "va") {
        router.replace("/dashboard");
      }
    }
    checkRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTeamData = useCallback(async () => {
    const supabase = createClient();
    const today = todayStart();

    const [profilesRes, sessionsRes, logsRes, screenshotsRes] =
      await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("sessions").select("*"),
        supabase
          .from("time_logs")
          .select("*")
          .gte("start_time", today),
        supabase
          .from("task_screenshots")
          .select("*")
          .gte("created_at", today),
      ]);

    const profiles = (profilesRes.data ?? []) as Profile[];
    const sessions = (sessionsRes.data ?? []) as Session[];
    const logs = (logsRes.data ?? []) as TimeLog[];
    const screenshots = (screenshotsRes.data ?? []) as TaskScreenshot[];

    const teamMembers: TeamMember[] = profiles.map((profile) => {
      const session =
        sessions.find((s) => s.user_id === profile.id) ?? null;

      const userLogs = logs.filter((l) => l.user_id === profile.id);
      const nonBreakLogs = userLogs.filter((l) => l.category !== "Break");
      const todayHoursMs = nonBreakLogs.reduce(
        (sum, l) => sum + (l.duration_ms || 0),
        0
      );
      const todayTaskCount = nonBreakLogs.length;
      const todayScreenshots = screenshots.filter(
        (s) => s.user_id === profile.id
      ).length;

      // Time allocation breakdown
      const personalMs = userLogs
        .filter((l) => l.category === "Personal")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const sortingMs = userLogs
        .filter((l) => l.category === "Sorting" || l.category === "Sorting Tasks")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const breakMs = userLogs
        .filter((l) => l.category === "Break")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const taskMs = userLogs
        .filter((l) => !["Personal", "Sorting", "Sorting Tasks", "Break"].includes(l.category))
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);

      let status: TeamMember["status"] = "away";
      let currentTaskName: string | null = null;
      let currentTaskMeta: string | null = null;

      // Mark sessions as stale if no update in 5 minutes
      const STALE_THRESHOLD_MS = 5 * 60 * 1000;
      const isSessionStale =
        session?.updated_at &&
        Date.now() - new Date(session.updated_at).getTime() > STALE_THRESHOLD_MS;

      if (isSessionStale) {
        status = "away";
        currentTaskName = null;
        currentTaskMeta = null;
      } else if (session?.clocked_in && session.active_task) {
        const task = session.active_task;
        if (task.isBreak) {
          status = "on-break";
          currentTaskName = "On Break";
          currentTaskMeta = "";
        } else {
          status = "working";
          currentTaskName = task.task_name || null;
          const parts = [task.account, task.client_name].filter(Boolean);
          currentTaskMeta = parts.join(" \u00b7 ") || null;
        }
      } else if (nonBreakLogs.length > 0) {
        const lastLog = nonBreakLogs[nonBreakLogs.length - 1];
        currentTaskName = lastLog.task_name || null;
        const parts = [lastLog.account, lastLog.client_name].filter(Boolean);
        currentTaskMeta = parts.join(" \u00b7 ") || null;
      }

      return {
        profile,
        session,
        todayHoursMs,
        todayTaskCount,
        todayScreenshots,
        currentTaskName,
        currentTaskMeta,
        status,
        personalMs,
        sortingMs,
        taskMs,
        breakMs,
        todayLogs: userLogs,
      };
    });

    const order = { working: 0, "on-break": 1, away: 2 };
    teamMembers.sort((a, b) => order[a.status] - order[b.status]);

    setMembers(teamMembers);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTeamData();

    const interval = setInterval(fetchTeamData, 30000);

    const supabase = createClient();
    const channel = supabase
      .channel("team-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        () => {
          fetchTeamData();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchTeamData]);

  // ─── Force Logout Handler ──────────────────────────────
  const handleForceLogout = useCallback(async (targetUserId: string, fullName: string) => {
    if (!confirm(`Force logout ${fullName}? This will close their active task and clock them out.`)) return;

    const supabase = createClient();
    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Find open time logs for this user so we can calculate real durations
    const { data: openLogs } = await supabase
      .from("time_logs")
      .select("id, start_time")
      .eq("user_id", targetUserId)
      .is("end_time", null);

    // Close each open log with its actual elapsed duration
    if (openLogs && openLogs.length > 0) {
      for (const log of openLogs) {
        const elapsed = log.start_time
          ? nowMs - new Date(log.start_time).getTime()
          : 0;
        await supabase
          .from("time_logs")
          .update({ end_time: now, duration_ms: Math.max(0, elapsed) })
          .eq("id", log.id);
      }
    }

    // Clock them out
    await supabase.from("sessions").upsert(
      {
        user_id: targetUserId,
        clocked_in: false,
        clock_in_time: null,
        clock_out_time: now,
        active_task: null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

    // Refresh team data
    fetchTeamData();
  }, [fetchTeamData]);

  const activeCount = members.filter((m) => m.status === "working").length;
  const totalTasks = members.reduce((sum, m) => sum + m.todayTaskCount, 0);
  const totalHoursMs = members.reduce((sum, m) => sum + m.todayHoursMs, 0);
  const onBreakCount = members.filter(
    (m) => m.status === "on-break"
  ).length;

  // Financial summary (admin only)
  const financialSummary = useMemo(() => {
    let totalPayable = 0;
    let totalBillableHoursMs = 0;

    members.forEach((m) => {
      const payable = computePayable(
        m.todayHoursMs,
        m.profile.pay_rate || 0,
        m.profile.pay_rate_type || "hourly"
      );
      totalPayable += payable;
      totalBillableHoursMs += m.taskMs;
    });

    return {
      totalPayable,
      totalBillableHoursMs,
      totalInternalCost: totalPayable,
    };
  }, [members]);

  // Don't render anything for VAs (redirect in progress)
  if (role === "va") {
    return null;
  }

  const isAdmin = role === "admin";

  return (
    <>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-espresso">Team</h1>
        <p className="mt-0.5 text-[13px] text-bark">
          {members.length} members &middot; {activeCount} currently active
        </p>
      </div>

      {/* Stats Row */}
      <div className={`mb-6 grid gap-4 ${isAdmin ? "grid-cols-5" : "grid-cols-4"}`}>
        <StatCard value={activeCount} label="Active Now" color="green" />
        <StatCard value={totalTasks} label="Tasks Today" color="terra" />
        <StatCard
          value={formatDuration(totalHoursMs)}
          label="Team Total Today"
          color="default"
        />
        <StatCard value={onBreakCount} label="On Break" color="gold" />
        {isAdmin && (
          <StatCard
            value={formatCurrency(financialSummary.totalPayable)}
            label="Est. Payable Today"
            color="terra"
          />
        )}
      </div>

      {/* Financial Summary (admin only) */}
      {isAdmin && (
        <div className="mb-6 rounded-xl border border-sand bg-white">
          <div className="border-b border-parchment px-5 py-4">
            <h2 className="text-sm font-bold text-espresso">Financial Summary</h2>
          </div>
          <div className="grid grid-cols-3 divide-x divide-parchment">
            <div className="p-5 text-center">
              <div className="font-serif text-xl font-bold text-sage">
                {formatCurrency(financialSummary.totalPayable)}
              </div>
              <div className="mt-1 text-[11px] font-semibold text-bark">
                Total Payable
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="font-serif text-xl font-bold text-terracotta">
                {formatDuration(financialSummary.totalBillableHoursMs)}
              </div>
              <div className="mt-1 text-[11px] font-semibold text-bark">
                Billable Hours
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="font-serif text-xl font-bold text-espresso">
                {formatCurrency(financialSummary.totalInternalCost)}
              </div>
              <div className="mt-1 text-[11px] font-semibold text-bark">
                Internal Cost
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Grid */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-xl border border-sand bg-white"
            />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-sand bg-white p-8 text-center">
          <p className="text-sm text-bark">
            No team members found. Invite your team to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
            <MemberCard
              key={member.profile.id}
              member={member}
              isAdmin={isAdmin}
              onForceLogout={isAdmin ? handleForceLogout : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Stat Card ────────────────────────────────────────────── */

function StatCard({
  value,
  label,
  color,
}: {
  value: string | number;
  label: string;
  color: "green" | "terra" | "gold" | "default";
}) {
  const colorClass = {
    green: "text-sage",
    terra: "text-terracotta",
    gold: "text-amber",
    default: "text-espresso",
  }[color];

  return (
    <div className="rounded-xl border border-sand bg-white px-5 py-[18px]">
      <div className={`font-serif text-[28px] font-bold ${colorClass}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-bark">{label}</div>
    </div>
  );
}

/* ── Member Card ──────────────────────────────────────────── */

function MemberCard({ member, isAdmin, onForceLogout }: { member: TeamMember; isAdmin: boolean; onForceLogout?: (userId: string, fullName: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { profile, status, currentTaskName, currentTaskMeta } = member;
  const avatarColor = getAvatarColor(profile.id);

  const statusConfig = {
    working: {
      label: "Working",
      bgClass: "bg-sage-soft",
      textClass: "text-sage",
    },
    "on-break": {
      label: "On Break",
      bgClass: "bg-amber-soft",
      textClass: "text-amber",
    },
    away: {
      label: "Offline",
      bgClass: "bg-parchment",
      textClass: "text-stone",
    },
  }[status];

  const payable = computePayable(
    member.todayHoursMs,
    profile.pay_rate || 0,
    profile.pay_rate_type || "hourly"
  );

  // Sort logs: most recent first
  const sortedLogs = [...member.todayLogs].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  return (
    <div className="overflow-hidden rounded-xl border border-sand bg-white transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,.06)]">
      {/* Top: Avatar + Name + Status */}
      <div className="flex items-center gap-3.5 px-5 pt-5 pb-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {getInitials(profile.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-espresso">
            {profile.full_name}
          </div>
          <div className="text-[11px] text-bark">
            {profile.position || profile.department || "Team Member"}
            {(profile as Profile & { employee_number?: string }).employee_number && (
              <span className="ml-1.5 text-stone">&middot; {(profile as Profile & { employee_number?: string }).employee_number}</span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-[3px] text-[10px] font-semibold ${statusConfig.bgClass} ${statusConfig.textClass}`}
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Task Info */}
      <div className="px-5 pb-4">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-bark">
          {status === "away" ? "Last Task" : "Current Task"}
        </div>
        <div className="text-[13px] font-semibold text-espresso">
          {currentTaskName || "\u2014"}
        </div>
        <div className="mt-0.5 text-[11px] text-stone">
          {currentTaskMeta || "No recent activity"}
        </div>
      </div>

      {/* Expandable Task List Toggle */}
      {sortedLogs.length > 0 && (
        <div className="px-5 pb-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between py-1.5 px-3 rounded-lg bg-parchment/50 hover:bg-parchment text-[11px] font-semibold text-bark cursor-pointer transition-colors"
          >
            <span>{expanded ? "Hide" : "Show"} Today&apos;s Tasks ({sortedLogs.length})</span>
            <span className="text-[9px]">{expanded ? "\u25B2" : "\u25BC"}</span>
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5 max-h-[240px] overflow-y-auto">
              {sortedLogs.map((log) => {
                const startTime = new Date(log.start_time).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                });
                const duration = log.duration_ms > 0
                  ? formatDuration(log.duration_ms)
                  : log.end_time
                    ? formatDuration(new Date(log.end_time).getTime() - new Date(log.start_time).getTime())
                    : "active";
                const isActive = !log.end_time;

                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-2 py-2 px-2.5 rounded-lg ${
                      isActive ? "bg-sage-soft/50 border border-sage/20" : "bg-parchment/30"
                    }`}
                  >
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      log.category === "Break" ? "bg-stone" :
                      log.category === "Personal" ? "bg-clay-rose" :
                      log.category === "Sorting" || log.category === "Sorting Tasks" ? "bg-amber" :
                      "bg-sage"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-espresso truncate">
                        {log.task_name}
                      </div>
                      <div className="text-[10px] text-bark truncate">
                        {[log.account, log.category].filter(Boolean).join(" \u00B7 ")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-[11px] font-semibold ${isActive ? "text-sage" : "text-espresso"}`}>
                        {duration}
                      </div>
                      <div className="text-[9px] text-stone">{startTime}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pay Rate + Payable (admin only) */}
      {isAdmin && profile.pay_rate > 0 && (
        <div className="px-5 pb-3 flex items-center justify-between">
          <span className="text-[10px] text-bark">
            {formatCurrency(profile.pay_rate)}/{profile.pay_rate_type || "hourly"}
          </span>
          <span className="text-[11px] font-semibold text-sage">
            {formatCurrency(payable)} today
          </span>
        </div>
      )}

      {/* Force Logout (admin only, when VA is active) */}
      {isAdmin && status !== "away" && onForceLogout && (
        <div className="px-5 pb-3">
          <button
            onClick={() => onForceLogout(profile.id, profile.full_name)}
            className="w-full py-1.5 rounded-lg bg-parchment text-bark border border-sand text-[11px] font-semibold cursor-pointer transition-all hover:bg-terracotta-soft hover:text-terracotta hover:border-terracotta"
          >
            Force Logout
          </button>
        </div>
      )}

      {/* Time Allocation (admin only) */}
      {isAdmin && member.todayHoursMs > 0 && (
        <div className="px-5 pb-3">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-parchment">
            {member.taskMs > 0 && (
              <div
                className="bg-sage"
                style={{ width: `${(member.taskMs / (member.todayHoursMs + member.breakMs + member.personalMs || 1)) * 100}%` }}
              />
            )}
            {member.sortingMs > 0 && (
              <div
                className="bg-amber"
                style={{ width: `${(member.sortingMs / (member.todayHoursMs + member.breakMs + member.personalMs || 1)) * 100}%` }}
              />
            )}
            {member.personalMs > 0 && (
              <div
                className="bg-clay-rose"
                style={{ width: `${(member.personalMs / (member.todayHoursMs + member.breakMs + member.personalMs || 1)) * 100}%` }}
              />
            )}
            {member.breakMs > 0 && (
              <div
                className="bg-stone"
                style={{ width: `${(member.breakMs / (member.todayHoursMs + member.breakMs + member.personalMs || 1)) * 100}%` }}
              />
            )}
          </div>
          <div className="mt-1.5 flex gap-3 text-[9px] text-bark">
            {member.taskMs > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                Tasks {formatDuration(member.taskMs)}
              </span>
            )}
            {member.sortingMs > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber" />
                Sorting {formatDuration(member.sortingMs)}
              </span>
            )}
            {member.personalMs > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-clay-rose" />
                Personal {formatDuration(member.personalMs)}
              </span>
            )}
            {member.breakMs > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-stone" />
                Break {formatDuration(member.breakMs)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats Footer */}
      <div className="grid grid-cols-3 border-t border-parchment bg-parchment/30">
        <div className="border-r border-parchment p-3 text-center">
          <div
            className={`text-sm font-bold ${status !== "away" ? "text-sage" : "text-espresso"}`}
          >
            {formatDuration(member.todayHoursMs)}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-[0.5px] text-bark">
            Today
          </div>
        </div>
        <div className="border-r border-parchment p-3 text-center">
          <div className="text-sm font-bold text-espresso">
            {member.todayTaskCount}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-[0.5px] text-bark">
            Tasks
          </div>
        </div>
        <div className="p-3 text-center">
          <div className="text-sm font-bold text-espresso">
            {member.todayScreenshots}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-[0.5px] text-bark">
            Screenshots
          </div>
        </div>
      </div>
    </div>
  );
}
