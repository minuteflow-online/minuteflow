"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Session, TimeLog, TaskScreenshot, UserRole } from "@/types/database";
import {
  formatDuration,
  getInitials,
  getAvatarColor,
  getTodayBoundsInTimezone,
  getWeekBoundsInTimezone,
  getMonthBoundsInTimezone,
  formatDateLocalTZ,
} from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────── */

type DateRangePreset = "today" | "week" | "month" | "custom";

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
  wizardMs: number;
  collaborationMs: number;
  meetingMs: number;
  messageMs: number;
  // Period's logs for expandable task list
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

function formatDateShort(d: Date, timezone?: string): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timezone ? { timeZone: timezone } : {}) });
}

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ── Page Component ───────────────────────────────────────── */

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgTimezone, setOrgTimezone] = useState<string>("UTC");

  // Date range state
  const [datePreset, setDatePreset] = useState<DateRangePreset>("today");
  const [customStart, setCustomStart] = useState<string>(formatDateInput(new Date()));
  const [customEnd, setCustomEnd] = useState<string>(formatDateInput(new Date()));

  // Member selection state
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  // Mood data: { [userId]: { [session_date_YYYY-MM-DD]: mood } }
  const [moodData, setMoodData] = useState<Record<string, Record<string, string>>>({});

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

  // Compute date range boundaries
  const { rangeStart, rangeEnd, periodLabel } = useMemo(() => {
    const tz = orgTimezone || "UTC";
    if (datePreset === "today") {
      const { start, end } = getTodayBoundsInTimezone(tz);
      return { rangeStart: new Date(start), rangeEnd: new Date(end), periodLabel: "Today" };
    }
    if (datePreset === "week") {
      const { start, end } = getWeekBoundsInTimezone(tz);
      const s = new Date(start);
      const e = new Date(end);
      const label = `${formatDateShort(s, tz)} \u2013 ${formatDateShort(e, tz)}`;
      return { rangeStart: s, rangeEnd: e, periodLabel: label };
    }
    if (datePreset === "month") {
      const { start, end } = getMonthBoundsInTimezone(tz);
      const s = new Date(start);
      const label = s.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: tz });
      return { rangeStart: s, rangeEnd: new Date(end), periodLabel: label };
    }
    // custom
    const s = new Date(customStart + "T00:00:00");
    const e = new Date(customEnd + "T23:59:59.999");
    const label = `${formatDateShort(s, tz)} \u2013 ${formatDateShort(e, tz)}`;
    return { rangeStart: s, rangeEnd: e, periodLabel: label };
  }, [datePreset, customStart, customEnd, orgTimezone]);

  const isToday = datePreset === "today";

  const fetchTeamData = useCallback(async () => {
    const supabase = createClient();

    const startISO = rangeStart.toISOString();
    const endISO = rangeEnd.toISOString();

    const moodStart = rangeStart.toISOString().split("T")[0];
    const moodEnd = rangeEnd.toISOString().split("T")[0];

    const [profilesRes, sessionsRes, logsRes, screenshotsRes, moodRes, orgRes] =
      await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("sessions").select("*"),
        supabase
          .from("time_logs")
          .select("*")
          .gte("session_date", moodStart)
          .lte("session_date", moodEnd),
        supabase
          .from("task_screenshots")
          .select("*")
          .gte("created_at", startISO)
          .lte("created_at", endISO),
        supabase
          .from("mood_logs")
          .select("user_id, session_date, mood")
          .gte("session_date", moodStart)
          .lte("session_date", moodEnd),
        supabase.from("organization_settings").select("timezone").limit(1).single(),
      ]);

    if (orgRes.data?.timezone) {
      setOrgTimezone(orgRes.data.timezone);
    }

    const allProfiles = (profilesRes.data ?? []) as Profile[];
    const profiles = allProfiles.filter((p) => p.is_active !== false);
    const sessions = (sessionsRes.data ?? []) as Session[];
    const logs = (logsRes.data ?? []) as TimeLog[];
    const screenshots = (screenshotsRes.data ?? []) as TaskScreenshot[];

    // Build mood lookup: { userId: { "YYYY-MM-DD": mood } }
    const moodLookup: Record<string, Record<string, string>> = {};
    if (moodRes.data) {
      (moodRes.data as { user_id: string; session_date: string; mood: string }[]).forEach((row) => {
        if (!moodLookup[row.user_id]) moodLookup[row.user_id] = {};
        moodLookup[row.user_id][row.session_date] = row.mood;
      });
    }
    setMoodData(moodLookup);

    const teamMembers: TeamMember[] = profiles.map((profile) => {
      const session =
        sessions.find((s) => s.user_id === profile.id) ?? null;

      const userLogs = logs.filter((l) => l.user_id === profile.id);
      const nonBreakLogs = userLogs.filter((l) => l.category !== "Break");
      const todayHoursMs = userLogs.reduce(
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
        .filter((l) => l.category === "Planning" || l.category === "Sorting" || l.category === "Sorting Tasks")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const breakMs = userLogs
        .filter((l) => l.category === "Break")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const taskMs = userLogs
        .filter((l) => !["Personal", "Planning", "Sorting", "Sorting Tasks", "Break", "Collaboration", "Meeting", "Communication", "Message"].includes(l.category))
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const wizardMs = userLogs.reduce((sum, l) => sum + (l.form_fill_ms || 0), 0);
      const collaborationMs = userLogs
        .filter((l) => l.category === "Collaboration")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const meetingMs = userLogs
        .filter((l) => l.category === "Meeting")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
      const messageMs = userLogs
        .filter((l) => l.category === "Communication" || l.category === "Message")
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
        wizardMs,
        collaborationMs,
        meetingMs,
        messageMs,
        todayLogs: userLogs,
      };
    });

    const order = { working: 0, "on-break": 1, away: 2 };
    teamMembers.sort((a, b) => order[a.status] - order[b.status]);

    setMembers(teamMembers);
    setLoading(false);
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    setLoading(true);
    fetchTeamData();

    // Only auto-refresh when viewing today
    if (isToday) {
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
    }
  }, [fetchTeamData, isToday]);

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

    // Clock them out (use update, not upsert — RLS INSERT policy blocks admins)
    await supabase
      .from("sessions")
      .update({
        clocked_in: false,
        clock_in_time: null,
        clock_out_time: now,
        active_task: null,
        updated_at: now,
      })
      .eq("user_id", targetUserId);

    // Refresh team data
    fetchTeamData();
  }, [fetchTeamData]);

  // ─── Member Selection Handlers ─────────────────────────
  const toggleMember = useCallback((memberId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedMembers(new Set(members.map((m) => m.profile.id)));
  }, [members]);

  const clearSelection = useCallback(() => {
    setSelectedMembers(new Set());
  }, []);

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

  const hasSelection = selectedMembers.size > 0;

  // Split members into selected (expanded) and unselected (compact)
  const expandedMembers = hasSelection
    ? members.filter((m) => selectedMembers.has(m.profile.id))
    : [];
  const compactMembers = hasSelection
    ? members.filter((m) => !selectedMembers.has(m.profile.id))
    : members;

  // Don't render anything for VAs (redirect in progress)
  if (role === "va") {
    return null;
  }

  const isAdmin = role === "admin";

  // Dynamic labels based on date range
  const periodSuffix = isToday ? "Today" : periodLabel;

  return (
    <>
      {/* Page Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">Team</h1>
          <p className="mt-0.5 text-[13px] text-bark">
            {members.length} members &middot; {activeCount} currently active
            {!isToday && (
              <span className="ml-1.5 text-terracotta font-semibold">&middot; Viewing: {periodLabel}</span>
            )}
          </p>
        </div>
      </div>

      {/* Date Range Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["today", "week", "month", "custom"] as DateRangePreset[]).map((preset) => {
          const labels: Record<DateRangePreset, string> = {
            today: "Today",
            week: "This Week",
            month: "This Month",
            custom: "Custom",
          };
          return (
            <button
              key={preset}
              onClick={() => setDatePreset(preset)}
              className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all cursor-pointer ${
                datePreset === preset
                  ? "bg-white text-espresso border border-sand shadow-sm"
                  : "bg-parchment text-walnut border border-sand hover:bg-sand"
              }`}
            >
              {labels[preset]}
            </button>
          );
        })}

        {datePreset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso"
            />
            <span className="text-[13px] text-bark">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso"
            />
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className={`mb-6 grid gap-4 ${isAdmin ? "grid-cols-5" : "grid-cols-4"}`}>
        <StatCard value={activeCount} label="Active Now" color="green" />
        <StatCard value={totalTasks} label={`Tasks ${isToday ? "Today" : ""}`} color="terra" />
        <StatCard
          value={formatDuration(totalHoursMs)}
          label={`Team Total ${isToday ? "Today" : ""}`}
          color="default"
        />
        <StatCard value={onBreakCount} label="On Break" color="gold" />
        {isAdmin && (
          <StatCard
            value={formatCurrency(financialSummary.totalPayable)}
            label={`Est. Payable ${isToday ? "Today" : ""}`}
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

      {/* Member Selection Controls */}
      {!loading && members.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[12px] font-semibold text-bark">
            {hasSelection
              ? `${selectedMembers.size} of ${members.length} selected`
              : "Click a member to expand"}
          </span>
          <div className="flex gap-2">
            {hasSelection ? (
              <button
                onClick={clearSelection}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold bg-parchment text-walnut border border-sand hover:bg-sand transition-all cursor-pointer"
              >
                Clear Selection
              </button>
            ) : (
              <button
                onClick={selectAll}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold bg-parchment text-walnut border border-sand hover:bg-sand transition-all cursor-pointer"
              >
                Select All
              </button>
            )}
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
        <>
          {/* Expanded (selected) members — full width */}
          {expandedMembers.length > 0 && (
            <div className="mb-6 space-y-4">
              {expandedMembers.map((member) => (
                <ExpandedMemberCard
                  key={member.profile.id}
                  member={member}
                  isAdmin={isAdmin}
                  isToday={isToday}
                  onForceLogout={isAdmin ? handleForceLogout : undefined}
                  onDeselect={() => toggleMember(member.profile.id)}
                  userMoods={moodData[member.profile.id] || {}}
                  timezone={orgTimezone}
                />
              ))}
            </div>
          )}

          {/* Compact (unselected) members — grid */}
          {compactMembers.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {compactMembers.map((member) => (
                <MemberCard
                  key={member.profile.id}
                  member={member}
                  isAdmin={isAdmin}
                  isToday={isToday}
                  isSelected={false}
                  onSelect={() => toggleMember(member.profile.id)}
                  onForceLogout={isAdmin ? handleForceLogout : undefined}
                  timezone={orgTimezone}
                />
              ))}
            </div>
          )}
        </>
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

/* ── Member Card (Compact) ───────────────────────────────── */

function MemberCard({ member, isAdmin, isToday, isSelected, onSelect, onForceLogout, timezone = "UTC" }: {
  member: TeamMember;
  isAdmin: boolean;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onForceLogout?: (userId: string, fullName: string) => void;
  timezone?: string;
}) {
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

  // Progress status counts
  const nonBreakLogs = sortedLogs.filter(l => l.category !== "Break" && l.category !== "Clock In");
  const inProgressCount = nonBreakLogs.filter(l => l.progress === "in_progress" || (!l.end_time && !l.progress)).length;
  const completedCount = nonBreakLogs.filter(l => l.progress === "completed").length;
  const onHoldCount = nonBreakLogs.filter(l => l.progress === "on_hold").length;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,.06)] ${
        isSelected ? "border-terracotta ring-2 ring-terracotta/20" : "border-sand"
      }`}
    >
      {/* Top: Avatar + Name + Status — clickable to select/expand */}
      <div
        className="flex items-center gap-3.5 px-5 pt-5 pb-4 cursor-pointer hover:bg-parchment/30 transition-colors"
        onClick={onSelect}
      >
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

      {/* Progress Status Badges */}
      {(inProgressCount > 0 || completedCount > 0 || onHoldCount > 0) && (
        <div className="px-5 pb-3 flex flex-wrap gap-1.5">
          {inProgressCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-[3px] text-[10px] font-semibold text-blue-600">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              {inProgressCount} In Progress
            </span>
          )}
          {completedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2.5 py-[3px] text-[10px] font-semibold text-sage">
              <span className="w-1.5 h-1.5 rounded-full bg-sage" />
              {completedCount} Completed
            </span>
          )}
          {onHoldCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-[3px] text-[10px] font-semibold text-amber">
              <span className="w-1.5 h-1.5 rounded-full bg-amber" />
              {onHoldCount} On Hold
            </span>
          )}
        </div>
      )}

      {/* Expandable Task List Toggle */}
      {sortedLogs.length > 0 && (
        <div className="px-5 pb-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between py-1.5 px-3 rounded-lg bg-parchment/50 hover:bg-parchment text-[11px] font-semibold text-bark cursor-pointer transition-colors"
          >
            <span>{expanded ? "Hide" : "Show"} Tasks ({sortedLogs.length})</span>
            <span className="text-[9px]">{expanded ? "\u25B2" : "\u25BC"}</span>
          </button>

          {expanded && (
            <TaskLogList logs={sortedLogs} timezone={timezone} />
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
            {formatCurrency(payable)} {isToday ? "today" : ""}
          </span>
        </div>
      )}

      {/* Force Logout (admin only, when VA is active, today only) */}
      {isAdmin && isToday && status !== "away" && onForceLogout && (
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
        <TimeAllocationBar member={member} />
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
            {isToday ? "Today" : "Total"}
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

/* ── Star Rating Component ───────────────────────────────── */

function StarRating({ value, onChange, readonly = false }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={`text-2xl transition-colors ${readonly ? "cursor-default" : "cursor-pointer"} ${
            star <= (hovered || value) ? "text-amber" : "text-sand"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/* ── Daily Ratings Panel ─────────────────────────────────── */

type DailyRating = {
  id: number;
  va_id: string;
  rated_by: string;
  rating_date: string;
  score: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function DailyRatingsPanel({ vaId, isAdmin, timezone = "UTC" }: { vaId: string; isAdmin: boolean; timezone?: string }) {
  const supabase = createClient();
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(5);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(formatDateInput(new Date()));
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchRatings = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("va_daily_ratings")
      .select("*")
      .eq("va_id", vaId)
      .order("rating_date", { ascending: false });
    setRatings((data as DailyRating[]) || []);
    setLoading(false);
  }, [vaId, supabase]);

  useEffect(() => { fetchRatings(); }, [fetchRatings]);

  const averageScore = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length
    : null;

  const handleSave = async () => {
    if (!score) return;
    setSaving(true);
    if (editingId) {
      await supabase
        .from("va_daily_ratings")
        .update({ score, notes: notes || null, updated_at: new Date().toISOString() })
        .eq("id", editingId);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("va_daily_ratings").upsert({
        va_id: vaId,
        rated_by: user!.id,
        rating_date: date,
        score,
        notes: notes || null,
      }, { onConflict: "va_id,rating_date" });
    }
    setScore(5);
    setNotes("");
    setDate(formatDateInput(new Date()));
    setEditingId(null);
    setSaving(false);
    fetchRatings();
  };

  const handleEdit = (r: DailyRating) => {
    setEditingId(r.id);
    setScore(r.score);
    setNotes(r.notes || "");
    setDate(r.rating_date);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setScore(5);
    setNotes("");
    setDate(formatDateInput(new Date()));
  };

  return (
    <div className="px-6 py-5">
      {/* Average */}
      <div className="mb-5 flex items-center gap-4">
        <div className="rounded-xl bg-parchment/60 px-5 py-3 text-center min-w-[100px]">
          <div className="font-serif text-2xl font-bold text-terracotta">
            {averageScore !== null ? averageScore.toFixed(1) : "—"}
          </div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.5px] text-bark mt-0.5">Avg Rating</div>
        </div>
        <div>
          {averageScore !== null && <StarRating value={Math.round(averageScore)} readonly />}
          <div className="text-[11px] text-bark mt-1">{ratings.length} rating{ratings.length !== 1 ? "s" : ""} total</div>
        </div>
      </div>

      {/* Add / Edit form (admin only) */}
      {isAdmin && (
        <div className="mb-5 rounded-xl border border-sand bg-parchment/30 p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-bark mb-3">
            {editingId ? "Edit Rating" : "Add Rating"}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[10px] text-bark mb-1">Date</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!!editingId}
                className="rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso disabled:opacity-50"
              />
            </div>
            <div>
              <div className="text-[10px] text-bark mb-1">Score</div>
              <StarRating value={score} onChange={setScore} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="text-[10px] text-bark mb-1">Notes (optional)</div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Great initiative today"
                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-[13px] text-espresso placeholder:text-stone"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !score}
                className="rounded-lg px-4 py-2 text-[12px] font-semibold bg-terracotta text-white hover:bg-terracotta/80 disabled:opacity-50 transition-all cursor-pointer"
              >
                {saving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
              {editingId && (
                <button
                  onClick={handleCancelEdit}
                  className="rounded-lg px-4 py-2 text-[12px] font-semibold bg-parchment text-bark border border-sand hover:bg-sand cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ratings list */}
      {loading ? (
        <div className="text-[13px] text-stone">Loading…</div>
      ) : ratings.length === 0 ? (
        <div className="text-[13px] text-stone py-4">No ratings yet.</div>
      ) : (
        <div className="space-y-2">
          {ratings.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-sand bg-white px-4 py-3">
              <div className="text-[12px] font-bold text-terracotta min-w-[90px]">
                {new Date(r.rating_date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone })}
              </div>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <span key={s} className={`text-base ${s <= r.score ? "text-amber" : "text-sand"}`}>★</span>
                ))}
              </div>
              <div className="flex-1 text-[12px] text-bark truncate">{r.notes || ""}</div>
              {isAdmin && (
                <button
                  onClick={() => handleEdit(r)}
                  className="text-[11px] text-walnut hover:text-terracotta cursor-pointer font-semibold"
                >
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Expanded Member Card (Full Width) ───────────────────── */

function ExpandedMemberCard({ member, isAdmin, isToday, onForceLogout, onDeselect, userMoods, timezone }: {
  member: TeamMember;
  isAdmin: boolean;
  isToday: boolean;
  onForceLogout?: (userId: string, fullName: string) => void;
  onDeselect: () => void;
  userMoods: Record<string, string>; // { "YYYY-MM-DD": mood }
  timezone: string;
}) {
  const { profile, status, currentTaskName, currentTaskMeta } = member;
  const avatarColor = getAvatarColor(profile.id);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"activity" | "ratings">("activity");

  const toggleDate = useCallback((dateLabel: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateLabel)) next.delete(dateLabel);
      else next.add(dateLabel);
      return next;
    });
  }, []);

  const statusConfig = {
    working: { label: "Working", bgClass: "bg-sage-soft", textClass: "text-sage" },
    "on-break": { label: "On Break", bgClass: "bg-amber-soft", textClass: "text-amber" },
    away: { label: "Offline", bgClass: "bg-parchment", textClass: "text-stone" },
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

  // Progress status counts (exclude breaks and clock-in entries)
  const progressLogs = sortedLogs.filter(l => l.category !== "Break" && l.category !== "Clock In");
  const inProgressCount = progressLogs.filter(l => l.progress === "in_progress" || (!l.end_time && !l.progress)).length;
  const completedCount = progressLogs.filter(l => l.progress === "completed").length;
  const onHoldCount = progressLogs.filter(l => l.progress === "on_hold").length;

  // Hours per account breakdown
  const accountBreakdown = useMemo(() => {
    const byAccount: Record<string, number> = {};
    member.todayLogs.forEach((log) => {
      const acct = log.account || "Unassigned";
      byAccount[acct] = (byAccount[acct] || 0) + (log.duration_ms || 0);
    });
    // Sort by most time first
    return Object.entries(byAccount).sort((a, b) => b[1] - a[1]);
  }, [member.todayLogs]);

  // Daily breakdown for multi-day ranges
  const moodEmoji: Record<string, string> = { bad: "\uD83D\uDE1E", neutral: "\uD83D\uDE10", good: "\uD83D\uDE0A" };

  const dailyBreakdown = useMemo(() => {
    if (isToday) return [];
    const byDate: Record<string, { logs: TimeLog[]; dateSort: number; isoDate: string }> = {};
    member.todayLogs.forEach((log) => {
      const isoDate = log.session_date || formatDateLocalTZ(new Date(log.start_time), timezone); // "YYYY-MM-DD"
      const d = new Date(isoDate + "T12:00:00"); // noon to avoid DST edge cases
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const dateSort = new Date(isoDate).getTime();
      if (!byDate[key]) byDate[key] = { logs: [], dateSort, isoDate };
      byDate[key].logs.push(log);
    });

    return Object.entries(byDate)
      .sort((a, b) => b[1].dateSort - a[1].dateSort) // newest first
      .map(([dateLabel, { logs: dayLogs, isoDate }]) => {
        const nonBreakLogs = dayLogs.filter(l => l.category !== "Break");
        const totalMs = dayLogs.reduce((sum, l) => sum + (l.duration_ms || 0), 0);
        const dayPayable = computePayable(totalMs, profile.pay_rate || 0, profile.pay_rate_type || "hourly");

        // Clock in: earliest start_time of non-break logs
        const clockIn = nonBreakLogs.length > 0
          ? new Date(Math.min(...nonBreakLogs.map(l => new Date(l.start_time).getTime())))
          : null;

        // Clock out: latest end_time of any log
        const logsWithEnd = dayLogs.filter(l => l.end_time);
        const hasActiveLog = dayLogs.some(l => !l.end_time);
        const clockOut = hasActiveLog
          ? null // still active
          : logsWithEnd.length > 0
            ? new Date(Math.max(...logsWithEnd.map(l => new Date(l.end_time!).getTime())))
            : null;

        // Look up mood for this date
        const mood = userMoods[isoDate] || null;

        // Progress counts for this day
        const dayInProgress = nonBreakLogs.filter(l => l.progress === "in_progress" || (!l.end_time && !l.progress)).length;
        const dayCompleted = nonBreakLogs.filter(l => l.progress === "completed").length;
        const dayOnHold = nonBreakLogs.filter(l => l.progress === "on_hold").length;

        return { dateLabel, totalMs, dayPayable, clockIn, clockOut, hasActiveLog, taskCount: nonBreakLogs.length, logs: dayLogs, mood, dayInProgress, dayCompleted, dayOnHold };
      });
  }, [member.todayLogs, isToday, profile.pay_rate, profile.pay_rate_type, userMoods]);

  // Category totals - only show non-zero
  const categoryTotals = useMemo(() => {
    const cats: { label: string; ms: number; color: string }[] = [];
    if (member.taskMs > 0) cats.push({ label: "Task", ms: member.taskMs, color: "bg-sage" });
    if (member.sortingMs > 0) cats.push({ label: "Planning", ms: member.sortingMs, color: "bg-amber" });
    if (member.breakMs > 0) cats.push({ label: "Break", ms: member.breakMs, color: "bg-stone" });
    if (member.wizardMs > 0) cats.push({ label: "Wizard", ms: member.wizardMs, color: "bg-indigo-400" });
    const totalCollabMs = member.collaborationMs + member.meetingMs;
    if (totalCollabMs > 0) cats.push({ label: "Collaboration", ms: totalCollabMs, color: "bg-sky-400" });
    if (member.messageMs > 0) cats.push({ label: "Communication", ms: member.messageMs, color: "bg-blue-400" });
    if (member.personalMs > 0) cats.push({ label: "Personal", ms: member.personalMs, color: "bg-clay-rose" });
    return cats;
  }, [member]);

  return (
    <div className="overflow-hidden rounded-xl border border-terracotta bg-white shadow-[0_4px_20px_rgba(0,0,0,.08)] ring-2 ring-terracotta/20">
      {/* Header Row */}
      <div className="flex items-center gap-4 px-6 pt-5 pb-4 bg-parchment/20">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {getInitials(profile.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-bold text-espresso">{profile.full_name}</div>
          <div className="text-[12px] text-bark">
            {profile.position || profile.department || "Team Member"}
            {(profile as Profile & { employee_number?: string }).employee_number && (
              <span className="ml-2 text-stone">&middot; {(profile as Profile & { employee_number?: string }).employee_number}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${statusConfig.bgClass} ${statusConfig.textClass}`}>
            {statusConfig.label}
          </span>
          {isAdmin && isToday && status !== "away" && onForceLogout && (
            <button
              onClick={() => onForceLogout(profile.id, profile.full_name)}
              className="rounded-lg px-3 py-1.5 text-[11px] font-semibold bg-parchment text-walnut border border-sand hover:bg-terracotta-soft hover:text-terracotta hover:border-terracotta transition-all cursor-pointer"
            >
              Force Logout
            </button>
          )}
          <button
            onClick={onDeselect}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold bg-parchment text-walnut border border-sand hover:bg-sand transition-all cursor-pointer"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Tab Strip */}
      <div className="flex border-b border-parchment px-6">
        {(["activity", "ratings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 px-4 text-[12px] font-semibold transition-colors cursor-pointer border-b-2 -mb-px ${
              activeTab === tab
                ? "border-terracotta text-terracotta"
                : "border-transparent text-bark hover:text-espresso"
            }`}
          >
            {tab === "activity" ? "Activity" : "Daily Ratings"}
          </button>
        ))}
      </div>

      {/* Daily Ratings Tab */}
      {activeTab === "ratings" && (
        <DailyRatingsPanel vaId={profile.id} isAdmin={isAdmin} timezone={timezone} />
      )}

      {/* Summary + Category Totals */}
      {activeTab === "activity" && <><div className="px-6 py-5 border-b border-parchment">
        {/* Row 1: Key Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-parchment/50 p-3 text-center">
            <div className={`text-lg font-bold ${status !== "away" ? "text-sage" : "text-espresso"}`}>
              {formatDuration(member.todayHoursMs)}
            </div>
            <div className="text-[9px] uppercase tracking-[0.5px] text-bark mt-0.5">Total Hours</div>
          </div>
          <div className="rounded-lg bg-parchment/50 p-3 text-center">
            <div className="text-lg font-bold text-espresso">{member.todayTaskCount}</div>
            <div className="text-[9px] uppercase tracking-[0.5px] text-bark mt-0.5">Total Tasks</div>
          </div>
          <div className="rounded-lg bg-parchment/50 p-3 text-center">
            <div className="text-lg font-bold text-espresso">{member.todayScreenshots}</div>
            <div className="text-[9px] uppercase tracking-[0.5px] text-bark mt-0.5">Screenshots</div>
          </div>
          {isAdmin && profile.pay_rate > 0 && (
            <div className="rounded-lg bg-parchment/50 p-3 text-center">
              <div className="text-lg font-bold text-sage">{formatCurrency(payable)}</div>
              <div className="text-[9px] uppercase tracking-[0.5px] text-bark mt-0.5">Payable</div>
            </div>
          )}
        </div>

        {/* Row 2: Progress Status */}
        {(inProgressCount > 0 || completedCount > 0 || onHoldCount > 0) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {inProgressCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-600">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {inProgressCount} In Progress
              </span>
            )}
            {completedCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1.5 text-[11px] font-semibold text-sage">
                <span className="w-2 h-2 rounded-full bg-sage" />
                {completedCount} Completed
              </span>
            )}
            {onHoldCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-soft px-3 py-1.5 text-[11px] font-semibold text-amber">
                <span className="w-2 h-2 rounded-full bg-amber" />
                {onHoldCount} On Hold
              </span>
            )}
          </div>
        )}

        {/* Row 3: Category Breakdown */}
        {categoryTotals.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-bark mb-2">Category Breakdown</div>
            <div className="flex flex-wrap gap-2">
              {categoryTotals.map((cat) => (
                <div key={cat.label} className="flex items-center gap-1.5 rounded-lg bg-parchment/40 px-3 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                  <span className="text-[11px] font-semibold text-espresso">{cat.label}</span>
                  <span className="text-[11px] text-bark">{formatDuration(cat.ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Row 3: Hours per Account */}
        {accountBreakdown.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-bark mb-2">Hours per Account</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {accountBreakdown.map(([account, ms]) => (
                <div key={account} className="flex items-center justify-between rounded-lg bg-parchment/40 px-3 py-2">
                  <span className="text-[12px] font-semibold text-espresso truncate mr-2">{account}</span>
                  <div className="text-right shrink-0">
                    <span className="text-[12px] font-bold text-espresso">{formatDuration(ms)}</span>
                    {isAdmin && profile.pay_rate > 0 && (
                      <span className="text-[10px] text-sage ml-2">
                        {formatCurrency(computePayable(ms, profile.pay_rate || 0, profile.pay_rate_type || "hourly"))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Expandable Daily Breakdown / Task Log */}
      <div className="px-6 py-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-bark mb-3">
          {dailyBreakdown.length > 0 ? "Daily Breakdown" : `Task Log (${sortedLogs.length} entries)`}
        </div>

        {sortedLogs.length === 0 ? (
          <div className="text-[13px] text-stone py-4">No tasks recorded in this period.</div>
        ) : dailyBreakdown.length > 0 ? (
          /* Multi-day: expandable date rows */
          <div className="space-y-2">
            {dailyBreakdown.map((day) => {
              const isExpanded = expandedDates.has(day.dateLabel);
              return (
                <div key={day.dateLabel} className="rounded-xl border border-sand overflow-hidden">
                  {/* Date header — clickable */}
                  <button
                    onClick={() => toggleDate(day.dateLabel)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-parchment/30 hover:bg-parchment/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] text-bark">{isExpanded ? "\u25BC" : "\u25B6"}</span>
                      <span className="text-[12px] font-bold text-terracotta min-w-[100px]">
                        {day.dateLabel}
                        {day.mood && <span className="ml-1.5" title={day.mood}>{moodEmoji[day.mood] || ""}</span>}
                      </span>
                      <span className="text-[11px] text-bark">
                        {day.clockIn
                          ? day.clockIn.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true })
                          : "\u2014"}
                        {" \u2192 "}
                        {day.hasActiveLog
                          ? "Still active"
                          : day.clockOut
                            ? day.clockOut.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true })
                            : "\u2014"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Mini status badges */}
                      {day.dayInProgress > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-[2px] text-[9px] font-semibold text-blue-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{day.dayInProgress}
                        </span>
                      )}
                      {day.dayCompleted > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-[2px] text-[9px] font-semibold text-sage">
                          <span className="w-1.5 h-1.5 rounded-full bg-sage" />{day.dayCompleted}
                        </span>
                      )}
                      {day.dayOnHold > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-[2px] text-[9px] font-semibold text-amber">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber" />{day.dayOnHold}
                        </span>
                      )}
                      <span className="text-[11px] text-bark">{day.taskCount} tasks</span>
                      <span className="text-[12px] font-bold text-espresso">{formatDuration(day.totalMs)}</span>
                      {isAdmin && profile.pay_rate > 0 && (
                        <span className="text-[12px] font-semibold text-sage">{formatCurrency(day.dayPayable)}</span>
                      )}
                    </div>
                  </button>

                  {/* Expanded: task list for this date */}
                  {isExpanded && (
                    <div className="px-4 py-3 border-t border-sand bg-white">
                      <TaskLogList logs={day.logs} showProgress timezone={timezone} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Today / single day: expandable single section */
          <div className="rounded-xl border border-sand overflow-hidden">
            <button
              onClick={() => toggleDate("today")}
              className="w-full flex items-center justify-between px-4 py-3 bg-parchment/30 hover:bg-parchment/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-bark">{expandedDates.has("today") ? "\u25BC" : "\u25B6"}</span>
                <span className="text-[12px] font-bold text-terracotta">Today&apos;s Tasks</span>
              </div>
              <div className="flex items-center gap-2">
                {inProgressCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-[2px] text-[9px] font-semibold text-blue-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{inProgressCount}
                  </span>
                )}
                {completedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-[2px] text-[9px] font-semibold text-sage">
                    <span className="w-1.5 h-1.5 rounded-full bg-sage" />{completedCount}
                  </span>
                )}
                {onHoldCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-[2px] text-[9px] font-semibold text-amber">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber" />{onHoldCount}
                  </span>
                )}
                <span className="text-[11px] text-bark">{sortedLogs.length} entries</span>
                <span className="text-[12px] font-bold text-espresso">{formatDuration(member.todayHoursMs)}</span>
              </div>
            </button>
            {expandedDates.has("today") && (
              <div className="px-4 py-3 border-t border-sand bg-white max-h-[400px] overflow-y-auto">
                <TaskLogList logs={sortedLogs} showProgress timezone={timezone} />
              </div>
            )}
          </div>
        )}
      </div>
    </>}
    </div>
  );
}

/* ── Task Log List (shared between compact & expanded) ───── */

function TaskLogList({ logs, showProgress, timezone = "UTC" }: { logs: TimeLog[]; showProgress?: boolean; timezone?: string }) {
  const progressConfig: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    in_progress: { label: "In Progress", bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-500" },
    completed: { label: "Completed", bg: "bg-sage-soft", text: "text-sage", dot: "bg-sage" },
    on_hold: { label: "On Hold", bg: "bg-amber-soft", text: "text-amber", dot: "bg-amber" },
  };

  return (
    <div className="mt-2 space-y-1.5">
      {logs.map((log) => {
        const startTime = new Date(log.start_time).toLocaleTimeString("en-US", {
          timeZone: timezone,
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
        const progress = log.progress || (isActive ? "in_progress" : null);
        const pConfig = progress ? progressConfig[progress] : null;

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
              log.category === "Planning" || log.category === "Sorting" || log.category === "Sorting Tasks" ? "bg-amber" :
              "bg-sage"
            }`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-espresso truncate">
                  {log.task_name}
                </span>
                {showProgress && pConfig && log.category !== "Break" && log.category !== "Clock In" && (
                  <span className={`inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-[1px] text-[9px] font-semibold ${pConfig.bg} ${pConfig.text}`}>
                    <span className={`w-1 h-1 rounded-full ${pConfig.dot}`} />
                    {pConfig.label}
                  </span>
                )}
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
  );
}

/* ── Time Allocation Bar ─────────────────────────────────── */

function TimeAllocationBar({ member }: { member: TeamMember }) {
  const totalMs = member.todayHoursMs + member.breakMs + member.personalMs || 1;

  return (
    <div className="px-5 pb-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-parchment">
        {member.taskMs > 0 && (
          <div
            className="bg-sage"
            style={{ width: `${(member.taskMs / totalMs) * 100}%` }}
          />
        )}
        {member.sortingMs > 0 && (
          <div
            className="bg-amber"
            style={{ width: `${(member.sortingMs / totalMs) * 100}%` }}
          />
        )}
        {member.personalMs > 0 && (
          <div
            className="bg-clay-rose"
            style={{ width: `${(member.personalMs / totalMs) * 100}%` }}
          />
        )}
        {member.breakMs > 0 && (
          <div
            className="bg-stone"
            style={{ width: `${(member.breakMs / totalMs) * 100}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex gap-3 text-[9px] text-bark">
        {member.taskMs > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sage" />
            Task {formatDuration(member.taskMs)}
          </span>
        )}
        {member.sortingMs > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber" />
            Planning {formatDuration(member.sortingMs)}
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
  );
}
