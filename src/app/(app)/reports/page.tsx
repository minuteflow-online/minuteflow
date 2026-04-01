"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, TimeLog, TaskScreenshot, UserRole } from "@/types/database";
import {
  formatDuration,
  getInitials,
  getAvatarColor,
  weekStart,
  weekEnd,
} from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────── */

type DateRange = "week" | "month";

type DailyData = {
  label: string;
  date: string;
  billableMs: number;
  personalMs: number;
  totalMs: number;
};

type AccountHours = {
  account: string;
  totalMs: number;
};

type PersonHours = {
  profile: Profile;
  totalMs: number;
  taskCount: number;
};

/* ── Page Component ───────────────────────────────────────── */

export default function ReportsPage() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [screenshots, setScreenshots] = useState<TaskScreenshot[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>({});
  const [dateRange, setDateRange] = useState<DateRange>("week");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("va");

  const { start, end, periodLabel } = useMemo(() => {
    const now = new Date();
    if (dateRange === "week") {
      const s = weekStart(now);
      const e = weekEnd(now);
      const label = `Week of ${s.toLocaleDateString("en-US", { month: "long", day: "numeric" })} \u2013 ${e.toLocaleDateString("en-US", { day: "numeric", year: "numeric" })}`;
      return { start: s, end: e, periodLabel: label };
    } else {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const label = s.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      return { start: s, end: e, periodLabel: label };
    }
  }, [dateRange]);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get current user and role
    const { data: { user } } = await supabase.auth.getUser();
    const currentUserId = user?.id || null;
    setUserId(currentUserId);

    if (currentUserId) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", currentUserId)
        .single();
      const userRole = (profileData?.role as UserRole) || "va";
      setRole(userRole);
    }

    // RLS handles filtering at DB level, but for VAs we also filter client-side
    // to ensure consistency (RLS already restricts to own rows for VAs)
    const [logsRes, profilesRes, screenshotsRes] = await Promise.all([
      supabase
        .from("time_logs")
        .select("*")
        .gte("start_time", start.toISOString())
        .lte("start_time", end.toISOString())
        .order("start_time", { ascending: true }),
      supabase.from("profiles").select("*"),
      supabase
        .from("task_screenshots")
        .select("*")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString()),
    ]);

    setLogs((logsRes.data ?? []) as TimeLog[]);
    setProfiles((profilesRes.data ?? []) as Profile[]);
    const ssData = (screenshotsRes.data ?? []) as TaskScreenshot[];
    setScreenshots(ssData);

    // Generate signed URLs for screenshot thumbnails
    if (ssData.length > 0) {
      const urlBatch: Record<number, string> = {};
      const toSign = ssData.slice(0, 12); // Only first 12 shown
      const results = await Promise.all(
        toSign.map(async (ss) => {
          const { data } = await supabase.storage
            .from("screenshots")
            .createSignedUrl(ss.storage_path, 3600);
          return { id: ss.id, url: data?.signedUrl || "" };
        })
      );
      results.forEach((r) => {
        if (r.url) urlBatch[r.id] = r.url;
      });
      setSignedUrls(urlBatch);
    } else {
      setSignedUrls({});
    }

    setLoading(false);
  }, [start, end]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  /* ── Computed stats ──────────────────────────────────────── */

  const totalHoursMs = useMemo(
    () =>
      logs
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
    [logs]
  );

  const billableMs = useMemo(
    () =>
      logs
        .filter((l) => l.billable)
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
    [logs]
  );

  const breakMs = useMemo(
    () =>
      logs
        .filter((l) => l.category === "Break")
        .reduce((sum, l) => sum + (l.duration_ms || 0), 0),
    [logs]
  );

  const tasksCompleted = useMemo(
    () => logs.filter((l) => l.end_time && l.category !== "Break").length,
    [logs]
  );

  /* ── Daily chart data ────────────────────────────────────── */

  const dailyData: DailyData[] = useMemo(() => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    if (dateRange === "week") {
      const days: DailyData[] = [];
      const ws = weekStart();
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayLogs = logs.filter(
          (l) => l.start_time && l.start_time.slice(0, 10) === dateStr
        );
        const billable = dayLogs
          .filter((l) => l.billable)
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
        const personal = dayLogs
          .filter((l) => l.category === "Personal")
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
        const total = dayLogs
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);

        days.push({
          label: dayNames[d.getDay()],
          date: dateStr,
          billableMs: billable,
          personalMs: personal,
          totalMs: total,
        });
      }
      return days;
    } else {
      const days: DailyData[] = [];
      const daysInMonth = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0
      ).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayLogs = logs.filter(
          (l) => l.start_time && l.start_time.slice(0, 10) === dateStr
        );
        const billable = dayLogs
          .filter((l) => l.billable)
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
        const personal = dayLogs
          .filter((l) => l.category === "Personal")
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);
        const total = dayLogs
          .reduce((sum, l) => sum + (l.duration_ms || 0), 0);

        days.push({
          label: i.toString(),
          date: dateStr,
          billableMs: billable,
          personalMs: personal,
          totalMs: total,
        });
      }
      return days;
    }
  }, [logs, dateRange, start]);

  const maxDayMs = useMemo(
    () => Math.max(...dailyData.map((d) => d.totalMs), 1),
    [dailyData]
  );

  /* ── By account ──────────────────────────────────────────── */

  const accountHours: AccountHours[] = useMemo(() => {
    const map: Record<string, number> = {};
    logs
      .forEach((l) => {
        const acct = l.account || "Unassigned";
        map[acct] = (map[acct] || 0) + (l.duration_ms || 0);
      });
    return Object.entries(map)
      .map(([account, totalMs]) => ({ account, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [logs]);

  const maxAccountMs = useMemo(
    () => Math.max(...accountHours.map((a) => a.totalMs), 1),
    [accountHours]
  );

  /* ── By person ───────────────────────────────────────────── */

  const personHours: PersonHours[] = useMemo(() => {
    const map: Record<string, { totalMs: number; taskCount: number }> = {};
    logs
      .forEach((l) => {
        if (!map[l.user_id]) map[l.user_id] = { totalMs: 0, taskCount: 0 };
        map[l.user_id].totalMs += l.duration_ms || 0;
        map[l.user_id].taskCount += 1;
      });
    return profiles
      .map((p) => ({
        profile: p,
        totalMs: map[p.id]?.totalMs || 0,
        taskCount: map[p.id]?.taskCount || 0,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [logs, profiles]);

  /* ── Export CSV ───────────────────────────────────────────── */

  const exportCSV = useCallback(() => {
    const header = [
      "Date",
      "Start Time",
      "End Time",
      "Duration (min)",
      "User",
      "Full Name",
      "Task",
      "Category",
      "Project",
      "Account",
      "Client",
      "Billable",
      "Client Memo",
      "Internal Memo",
    ];

    const rows = logs.map((l) => {
      const startDate = l.start_time
        ? new Date(l.start_time).toLocaleDateString()
        : "";
      const startTime = l.start_time
        ? new Date(l.start_time).toLocaleTimeString()
        : "";
      const endTime = l.end_time
        ? new Date(l.end_time).toLocaleTimeString()
        : "";
      const mins = l.duration_ms ? Math.round(l.duration_ms / 60000) : 0;
      return [
        startDate,
        startTime,
        endTime,
        mins.toString(),
        l.username || "",
        l.full_name || "",
        l.task_name || "",
        l.category || "",
        l.project || "",
        l.account || "",
        l.client_name || "",
        l.billable ? "Yes" : "No",
        l.client_memo || "",
        l.internal_memo || "",
      ];
    });

    const csvContent = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MinuteFlow-Report-${start.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [logs, start]);

  /* ── Export XLSX (HTML table for Excel) ──────────────────── */

  const exportXLSX = useCallback(() => {
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>`;
    html += `<table border="1"><thead><tr>`;
    const headers = [
      "Date",
      "Start",
      "End",
      "Duration (min)",
      "User",
      "Full Name",
      "Task",
      "Category",
      "Project",
      "Account",
      "Client",
      "Billable",
      "Client Memo",
      "Internal Memo",
    ];
    headers.forEach((h) => {
      html += `<th style="background:#3d3229;color:#fff;font-weight:bold;">${h}</th>`;
    });
    html += `</tr></thead><tbody>`;

    logs.forEach((l) => {
      const cat = l.category || "Task";
      const bg =
        cat === "Break"
          ? "#fff3cd"
          : cat === "Personal"
            ? "#fce4ec"
            : l.billable
              ? "#e8f4f8"
              : "#f5f5f5";
      html += `<tr style="background:${bg}">`;
      html += `<td>${l.start_time ? new Date(l.start_time).toLocaleDateString() : ""}</td>`;
      html += `<td>${l.start_time ? new Date(l.start_time).toLocaleTimeString() : ""}</td>`;
      html += `<td>${l.end_time ? new Date(l.end_time).toLocaleTimeString() : ""}</td>`;
      html += `<td>${l.duration_ms ? Math.round(l.duration_ms / 60000) : 0}</td>`;
      html += `<td>${l.username || ""}</td>`;
      html += `<td>${l.full_name || ""}</td>`;
      html += `<td>${l.task_name || ""}</td>`;
      html += `<td>${cat}</td>`;
      html += `<td>${l.project || ""}</td>`;
      html += `<td>${l.account || ""}</td>`;
      html += `<td>${l.client_name || ""}</td>`;
      html += `<td>${l.billable ? "Yes" : "No"}</td>`;
      html += `<td>${l.client_memo || ""}</td>`;
      html += `<td>${l.internal_memo || ""}</td>`;
      html += `</tr>`;
    });

    html += `</tbody></table></body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MinuteFlow-Report-${start.toISOString().slice(0, 10)}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }, [logs, start]);

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <>
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-espresso">
            Reports
          </h1>
          <p className="mt-0.5 text-[13px] text-bark">{periodLabel}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setDateRange("week")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "week"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setDateRange("month")}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-all ${
              dateRange === "month"
                ? "bg-white text-espresso border border-sand shadow-sm"
                : "bg-parchment text-walnut border border-sand hover:bg-sand"
            }`}
          >
            This Month
          </button>
          <button
            onClick={exportCSV}
            className="rounded-lg bg-parchment px-4 py-2 text-[13px] font-semibold text-walnut border border-sand transition-all hover:bg-sand"
          >
            Export CSV
          </button>
          <button
            onClick={exportXLSX}
            className="rounded-lg bg-terracotta px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-[#a85840]"
          >
            Export XLSX
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-sand bg-white"
            />
          ))}
        </div>
      ) : (
        <>
          {/* Big Stats */}
          <div className="mb-6 grid grid-cols-4 gap-4">
            <BigStat
              value={formatDuration(totalHoursMs)}
              label="Total Hours"
              color="default"
            />
            <BigStat
              value={formatDuration(billableMs)}
              label="Billable Hours"
              color="green"
            />
            <BigStat
              value={tasksCompleted}
              label="Tasks Completed"
              color="terra"
            />
            <BigStat
              value={formatDuration(breakMs)}
              label="Total Breaks"
              color="gold"
            />
          </div>

          {/* Daily Hours Chart */}
          <div className="mb-6 rounded-xl border border-sand bg-white">
            <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
              <h3 className="text-sm font-bold text-espresso">Daily Hours</h3>
              <span className="text-[11px] text-bark">
                {dateRange === "week" ? "This week" : "This month"}
              </span>
            </div>
            <div
              className="flex items-end gap-2.5 px-5 py-5"
              style={{ height: 220 }}
            >
              {dailyData.map((day) => {
                const billablePercent =
                  maxDayMs > 0 ? (day.billableMs / maxDayMs) * 100 : 0;
                const personalPercent =
                  maxDayMs > 0 ? (day.personalMs / maxDayMs) * 100 : 0;
                const hasData = day.totalMs > 0;

                return (
                  <div
                    key={day.date}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="text-[10px] font-bold text-espresso">
                      {hasData ? formatDuration(day.totalMs) : "\u2014"}
                    </span>
                    <div className="flex w-full flex-col items-stretch gap-0">
                      {day.personalMs > 0 && (
                        <div
                          className="w-full rounded-t-md bg-clay-rose opacity-50"
                          style={{
                            height: `${Math.max(personalPercent * 1.4, 4)}px`,
                          }}
                        />
                      )}
                      <div
                        className="w-full bg-sage"
                        style={{
                          height: `${Math.max(hasData ? billablePercent * 1.4 : 2, hasData ? 4 : 2)}px`,
                          opacity: hasData ? 1 : 0.2,
                          borderRadius:
                            day.personalMs > 0 ? "0" : "6px 6px 0 0",
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-bark">
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hours by Account + Financial Summary (admin) */}
          <div className={`mb-6 grid gap-5 ${role === "admin" ? "grid-cols-2" : "grid-cols-1"}`}>
            {/* Hours by Account */}
            <div className="rounded-xl border border-sand bg-white">
              <div className="border-b border-parchment px-5 py-4">
                <h3 className="text-sm font-bold text-espresso">
                  Hours by Account
                </h3>
              </div>
              <div className="px-5 py-4">
                {accountHours.length === 0 ? (
                  <p className="text-[13px] text-bark">No data yet</p>
                ) : (
                  accountHours.map((item, i) => {
                    const barColors = [
                      "var(--color-terracotta)",
                      "var(--color-sage)",
                      "var(--color-amber)",
                      "var(--color-clay-rose)",
                      "var(--color-slate-blue)",
                      "var(--color-walnut)",
                    ];
                    const barColor = barColors[i % barColors.length];
                    const pct = (item.totalMs / maxAccountMs) * 100;

                    return (
                      <div
                        key={item.account}
                        className="flex items-center gap-3.5 border-b border-parchment py-3 last:border-b-0"
                      >
                        <div className="flex-1 text-[13px] font-semibold text-espresso">
                          {item.account}
                        </div>
                        <div className="flex-[2] h-2 overflow-hidden rounded bg-parchment">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                        <div className="w-[70px] text-right font-serif text-sm font-bold text-sage">
                          {formatDuration(item.totalMs)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Financial Summary (admin only) */}
            {role === "admin" && (
              <div className="rounded-xl border border-sand bg-white">
                <div className="border-b border-parchment px-5 py-4">
                  <h3 className="text-sm font-bold text-espresso">
                    Financial Summary
                  </h3>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-bark">Billable Hours</span>
                    <span className="font-serif text-lg font-bold text-sage">
                      {formatDuration(billableMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-bark">Total Work Hours</span>
                    <span className="font-serif text-lg font-bold text-espresso">
                      {formatDuration(totalHoursMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-bark">Break Time</span>
                    <span className="font-serif text-lg font-bold text-amber">
                      {formatDuration(breakMs)}
                    </span>
                  </div>
                  <div className="border-t border-parchment pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-espresso">
                        Est. Internal Cost
                      </span>
                      <span className="font-serif text-lg font-bold text-terracotta">
                        {(() => {
                          let cost = 0;
                          personHours.forEach((ph) => {
                            const rate = ph.profile.pay_rate || 0;
                            const rateType = ph.profile.pay_rate_type || "hourly";
                            const hours = ph.totalMs / 3600000;
                            if (rateType === "hourly") cost += hours * rate;
                            else if (rateType === "daily") cost += (hours / 8) * rate;
                          });
                          return cost.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                            minimumFractionDigits: 2,
                          });
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Screenshot Gallery */}
          <div className="rounded-xl border border-sand bg-white">
            <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
              <h3 className="text-sm font-bold text-espresso">
                Recent Screenshots
              </h3>
              <span className="text-[11px] text-bark">
                {screenshots.length} this{" "}
                {dateRange === "week" ? "week" : "month"}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2 p-5">
              {screenshots.length === 0 ? (
                <div className="col-span-6 py-6 text-center text-[13px] text-bark">
                  No screenshots in this period
                </div>
              ) : (
                screenshots.slice(0, 12).map((ss) => {
                  const profile = profiles.find(
                    (p) => p.id === ss.user_id
                  );
                  const initials = profile
                    ? getInitials(profile.full_name)
                    : "??";
                  const time = new Date(ss.created_at).toLocaleTimeString(
                    "en-US",
                    { hour: "numeric", minute: "2-digit", hour12: true }
                  );
                  const url = signedUrls[ss.id];
                  return (
                    <div
                      key={ss.id}
                      className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded-lg border border-sand bg-parchment transition-all hover:scale-[1.03] hover:border-terracotta"
                    >
                      {url ? (
                        <img
                          src={url}
                          alt={`Screenshot by ${profile?.full_name || "Unknown"}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-stone">
                          Loading...
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[9px] font-semibold text-white">
                        {initials} &middot; {time}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ── Big Stat Card ────────────────────────────────────────── */

function BigStat({
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
    <div className="rounded-xl border border-sand bg-white px-5 py-[22px]">
      <div className={`font-serif text-[32px] font-bold ${colorClass}`}>
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold text-bark">{label}</div>
    </div>
  );
}
