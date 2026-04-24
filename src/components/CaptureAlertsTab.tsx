"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface CaptureAlert {
  id: number;
  user_id: string;
  alerted_at: string;
  action: "reshared" | "dismissed" | null;
  action_at: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
  session_date: string;
  created_at: string;
  // joined
  full_name: string | null;
  username: string | null;
}

interface Props {
  orgTimezone?: string;
}

function formatTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
}

function formatDate(iso: string, tz?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  });
}

function gapLabel(alerted_at: string, action_at: string | null): string {
  if (!action_at) return "—";
  const ms = new Date(action_at).getTime() - new Date(alerted_at).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export default function CaptureAlertsTab({ orgTimezone }: Props) {
  const supabase = createClient();
  const [alerts, setAlerts] = useState<CaptureAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "all">("today");
  const [vaFilter, setVaFilter] = useState<string>("all");

  const fetchAlerts = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("capture_alerts")
      .select(`
        *,
        profiles!capture_alerts_user_id_fkey (
          full_name,
          username
        )
      `)
      .order("alerted_at", { ascending: false })
      .limit(500);

    // Date filter
    const now = new Date();
    if (dateFilter === "today") {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      query = query.gte("alerted_at", startOfDay.toISOString());
    } else if (dateFilter === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      query = query.gte("alerted_at", weekAgo.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch capture_alerts:", error);
      setAlerts([]);
    } else {
      const rows = (data || []).map((r) => ({
        ...r,
        full_name: (r.profiles as { full_name: string | null; username: string | null } | null)?.full_name ?? null,
        username: (r.profiles as { full_name: string | null; username: string | null } | null)?.username ?? null,
      }));
      setAlerts(rows as CaptureAlert[]);
    }
    setLoading(false);
  }, [supabase, dateFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Build unique VA list for filter dropdown
  const vaOptions = Array.from(
    new Map(alerts.map((a) => [a.user_id, a.full_name || a.username || a.user_id])).entries()
  );

  const filtered = vaFilter === "all" ? alerts : alerts.filter((a) => a.user_id === vaFilter);

  // Summary counts
  const totalDrops = filtered.length;
  const reshared = filtered.filter((a) => a.action === "reshared").length;
  const dismissed = filtered.filter((a) => a.action === "dismissed").length;
  const noResponse = filtered.filter((a) => !a.action).length;

  function actionBadge(action: string | null) {
    if (action === "reshared") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-semibold text-sage">
          ✓ Reshared
        </span>
      );
    }
    if (action === "dismissed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          Dismissed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[11px] font-semibold text-terracotta">
        No Response
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Drops", value: totalDrops, color: "text-espresso" },
          { label: "Reshared", value: reshared, color: "text-sage" },
          { label: "Dismissed", value: dismissed, color: "text-amber-600" },
          { label: "No Response", value: noResponse, color: "text-terracotta" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-sand bg-white p-4">
            <p className="text-[12px] text-stone uppercase tracking-wide">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-sand overflow-hidden text-sm">
          {(["today", "week", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-4 py-2 font-medium transition-colors ${
                dateFilter === f
                  ? "bg-espresso text-white"
                  : "bg-white text-bark hover:bg-parchment"
              }`}
            >
              {f === "today" ? "Today" : f === "week" ? "Last 7 Days" : "All Time"}
            </button>
          ))}
        </div>

        <select
          value={vaFilter}
          onChange={(e) => setVaFilter(e.target.value)}
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm text-espresso focus:outline-none"
        >
          <option value="all">All VAs</option>
          {vaOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <button
          onClick={fetchAlerts}
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm text-bark hover:bg-parchment transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-stone">Loading alerts...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone">No capture drop events for this period.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand bg-parchment text-xs font-semibold uppercase tracking-wide text-stone">
                <th className="px-4 py-3 text-left">VA</th>
                <th className="px-4 py-3 text-left">Drop Time</th>
                <th className="px-4 py-3 text-left">Email Sent</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Response Time</th>
                <th className="px-4 py-3 text-left">Gap</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((alert, i) => (
                <tr
                  key={alert.id}
                  className={`border-b border-sand last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-parchment/30"}`}
                >
                  <td className="px-4 py-3 font-medium text-espresso">
                    {alert.full_name || alert.username || "Unknown"}
                  </td>
                  <td className="px-4 py-3 text-bark">
                    <div>{formatDate(alert.alerted_at, orgTimezone)}</div>
                    <div className="text-[11px] text-stone">{formatTime(alert.alerted_at, orgTimezone)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {alert.email_sent ? (
                      <span className="text-sage text-xs font-medium">✓ Sent</span>
                    ) : (
                      <span className="text-stone text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{actionBadge(alert.action)}</td>
                  <td className="px-4 py-3 text-bark">
                    {alert.action_at ? (
                      <>
                        <div>{formatDate(alert.action_at, orgTimezone)}</div>
                        <div className="text-[11px] text-stone">{formatTime(alert.action_at, orgTimezone)}</div>
                      </>
                    ) : (
                      <span className="text-stone text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-bark font-mono text-xs">
                    {gapLabel(alert.alerted_at, alert.action_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-stone">
        "No Response" means the VA neither reshared nor dismissed the banner — they may have closed the tab or ignored it.
        This data can be used in performance reviews.
      </p>
    </div>
  );
}
