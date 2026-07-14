"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTodayBoundsInTimezone, getWeekBoundsInTimezone } from "@/lib/utils";

type Period = "daily" | "weekly";
type ProgressLabel = "Ahead" | "On Track" | "Behind";

interface VAMetrics {
  vaId: string;
  productivityScore: number | null;
  accuracyScore: number | null;
  tokens: number;
  stars: number | null;
  progressPct: number | null;
  progressLabel: ProgressLabel | null;
}

interface VAPerformanceMetricsProps {
  /** VA user ids to compute metrics for. Pass a single id for the VA dashboard. */
  vaIds: string[];
  /** Display name for each vaId — required for the "compact" (admin) variant. */
  names?: Record<string, string>;
  orgTimezone: string;
  /** "detail" = full card (VA dashboard). "compact" = grid of mini cards (admin Overview). */
  variant: "detail" | "compact";
  showPeriodToggle?: boolean;
}

function progressLabelFor(pct: number): ProgressLabel {
  if (pct >= 90) return "Ahead";
  if (pct >= 70) return "On Track";
  return "Behind";
}

function colorFor(label: ProgressLabel | null): "sage" | "amber" | "terracotta" {
  if (label === "Ahead") return "sage";
  if (label === "On Track") return "amber";
  return "terracotta";
}

function scoreColor(value: number | null): string {
  if (value === null) return "text-stone";
  if (value >= 80) return "text-sage";
  if (value >= 60) return "text-amber";
  return "text-terracotta";
}

/** Fetches and renders Productivity / Accuracy / Ownership / Tokens / Stars / Progress
 * metrics for one or more VAs. Used on the VA dashboard, admin Overview tab, and
 * (via ProgressBar export) the Progress Report tab. */
export default function VAPerformanceMetrics({
  vaIds,
  names,
  orgTimezone,
  variant,
  showPeriodToggle = true,
}: VAPerformanceMetricsProps) {
  const supabase = createClient();
  const [period, setPeriod] = useState<Period>("daily");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Record<string, VAMetrics>>({});

  const fetchMetrics = useCallback(async () => {
    if (vaIds.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const dateBounds =
      period === "daily" ? getTodayBoundsInTimezone(orgTimezone) : getWeekBoundsInTimezone(orgTimezone);

    const dateStrs: string[] = (() => {
      if (period === "daily") {
        return [new Date().toLocaleDateString("en-CA", { timeZone: orgTimezone })];
      }
      const days: string[] = [];
      const weekStart = new Date(getWeekBoundsInTimezone(orgTimezone).start);
      for (let i = 0; i < 7; i++) {
        days.push(new Date(weekStart.getTime() + i * 86400000).toLocaleDateString("en-CA", { timeZone: orgTimezone }));
      }
      return days;
    })();

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

    const [logsRes, assigneesRes, plannedRes, tokensRes, ratingsRes] = await Promise.all([
      supabase
        .from("time_logs")
        .select("user_id,duration_ms,billable,category,start_time")
        .in("user_id", vaIds)
        .gte("start_time", dateBounds.start)
        .lte("start_time", dateBounds.end),
      supabase.from("assigned_task_assignees").select("va_id,status,accuracy_score,assigned_at").in("va_id", vaIds),
      supabase.from("planned_tasks").select("user_id,completed,plan_date").in("user_id", vaIds).in("plan_date", dateStrs),
      supabase.from("va_tokens").select("user_id").in("user_id", vaIds),
      supabase.from("va_daily_ratings").select("va_id,score,rating_date").in("va_id", vaIds).gte("rating_date", sevenDaysAgo),
    ]);

    const logs = logsRes.data ?? [];
    const assignees = assigneesRes.data ?? [];
    const planned = plannedRes.data ?? [];
    const tokens = tokensRes.data ?? [];
    const ratings = ratingsRes.data ?? [];

    const next: Record<string, VAMetrics> = {};

    for (const vaId of vaIds) {
      const vaLogs = logs.filter((l) => l.user_id === vaId);
      const billableMs = vaLogs.filter((l) => l.billable).reduce((s, l) => s + (l.duration_ms || 0), 0);
      const taskMs = vaLogs
        .filter((l) => l.billable && l.category === "Task")
        .reduce((s, l) => s + (l.duration_ms || 0), 0);
      const productivityScore = billableMs > 0 ? (taskMs / billableMs) * 100 : null;

      const vaAssignees = assignees.filter((a) => a.va_id === vaId);
      const scoredAssignees = vaAssignees.filter((a) => typeof a.accuracy_score === "number" && a.accuracy_score !== null);
      const accuracyScore =
        scoredAssignees.length > 0
          ? scoredAssignees.reduce((s, a) => s + (a.accuracy_score as number), 0) / scoredAssignees.length
          : null;

      const tokenCount = tokens.filter((t) => t.user_id === vaId).length;

      const vaRatings = ratings.filter((r) => r.va_id === vaId);
      const stars = vaRatings.length > 0 ? vaRatings.reduce((s, r) => s + r.score, 0) / vaRatings.length : null;

      const vaPlanned = planned.filter((p) => p.user_id === vaId);
      const vaAssigneesInRange = vaAssignees.filter((a) =>
        dateStrs.includes(new Date(a.assigned_at).toLocaleDateString("en-CA", { timeZone: orgTimezone }))
      );
      const completedPlanned = vaPlanned.filter((p) => p.completed).length;
      const completedAssigned = vaAssigneesInRange.filter((a) =>
        a.status === "completed" || a.status === "approved"
      ).length;
      const totalDue = vaPlanned.length + vaAssigneesInRange.length;
      const progressPct = totalDue > 0 ? ((completedPlanned + completedAssigned) / totalDue) * 100 : null;

      next[vaId] = {
        vaId,
        productivityScore,
        accuracyScore,
        tokens: tokenCount,
        stars,
        progressPct,
        progressLabel: progressPct !== null ? progressLabelFor(progressPct) : null,
      };
    }

    setMetrics(next);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaIds, orgTimezone, period]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="rounded-xl border border-sand bg-white p-4">
        <div className="h-16 animate-pulse rounded-lg bg-parchment" />
      </div>
    );
  }

  const PeriodToggle = showPeriodToggle ? (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setPeriod("daily")}
        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
          period === "daily" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
        }`}
      >
        Daily
      </button>
      <button
        onClick={() => setPeriod("weekly")}
        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
          period === "weekly" ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
        }`}
      >
        Weekly
      </button>
    </div>
  ) : null;

  if (variant === "detail") {
    const m = metrics[vaIds[0]];
    if (!m) return null;
    const label = m.progressLabel;
    const color = colorFor(label);
    return (
      <div className="rounded-xl border border-sand bg-white p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Performance</h3>
          {PeriodToggle}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <MetricTile label="Productivity" value={m.productivityScore !== null ? `${m.productivityScore.toFixed(0)}%` : "--"} colorClass={scoreColor(m.productivityScore)} />
          <MetricTile label="Accuracy" value={m.accuracyScore !== null ? `${m.accuracyScore.toFixed(1)}%` : "--"} colorClass={scoreColor(m.accuracyScore)} />
          <MetricTile label="Ownership" value="--" sub="(coming soon)" colorClass="text-stone" />
          <MetricTile label="Tokens" value={String(m.tokens)} colorClass="text-walnut" />
          <MetricTile label="Stars" value={m.stars !== null ? `${m.stars.toFixed(1)} ★` : "--"} colorClass="text-amber" />
        </div>
        <ProgressBar pct={m.progressPct} label={label} color={color} />
      </div>
    );
  }

  // compact variant — grid of mini cards, one per VA
  return (
    <div className="mb-6 rounded-xl border border-sand bg-white">
      <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
        <h2 className="text-sm font-bold text-espresso">Team Performance</h2>
        {PeriodToggle}
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {vaIds.map((vaId) => {
          const m = metrics[vaId];
          if (!m) return null;
          const name = names?.[vaId] || "Unknown";
          const label = m.progressLabel;
          const color = colorFor(label);
          return (
            <div key={vaId} className="rounded-lg border border-sand bg-white p-3">
              <div className="text-[12px] font-semibold text-espresso mb-2 truncate">{name}</div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <MiniStat label="Prod" value={m.productivityScore !== null ? `${m.productivityScore.toFixed(0)}%` : "--"} colorClass={scoreColor(m.productivityScore)} />
                <MiniStat label="Acc" value={m.accuracyScore !== null ? `${m.accuracyScore.toFixed(1)}%` : "--"} colorClass={scoreColor(m.accuracyScore)} />
                <MiniStat label="Tokens" value={String(m.tokens)} colorClass="text-walnut" />
              </div>
              <ProgressBar pct={m.progressPct} label={label} color={color} compact />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string;
  value: string;
  sub?: string;
  colorClass: string;
}) {
  return (
    <div className="rounded-lg border border-sand bg-cream px-3 py-2 text-center">
      <div className={`font-serif text-lg font-bold ${colorClass}`}>{value}</div>
      <div className="text-[10px] font-semibold text-bark">{label}</div>
      {sub && <div className="text-[9px] text-stone">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, colorClass }: { label: string; value: string; colorClass: string }) {
  return (
    <div className="text-center">
      <div className={`text-[13px] font-bold ${colorClass}`}>{value}</div>
      <div className="text-[9px] text-bark">{label}</div>
    </div>
  );
}

/** Shared progress bar with Ahead / On Track / Behind labeling — exported for reuse
 * in the Progress Report tab where per-VA metrics are already computed inline. */
export function ProgressBar({
  pct,
  label,
  color,
  compact = false,
}: {
  pct: number | null;
  label: ProgressLabel | null;
  color: "sage" | "amber" | "terracotta";
  compact?: boolean;
}) {
  const barColor = { sage: "bg-sage", amber: "bg-amber", terracotta: "bg-terracotta" }[color];
  const textColor = { sage: "text-sage", amber: "text-amber", terracotta: "text-terracotta" }[color];
  return (
    <div>
      <div className={`flex items-center justify-between ${compact ? "mb-1" : "mb-1.5"}`}>
        <span className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold text-bark`}>Progress</span>
        <span className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold ${textColor}`}>
          {pct !== null ? `${pct.toFixed(0)}% ${label}` : "No tasks"}
        </span>
      </div>
      <div className={`w-full ${compact ? "h-1.5" : "h-2"} rounded-full bg-sand overflow-hidden`}>
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${pct !== null ? Math.min(100, pct) : 0}%` }}
        />
      </div>
    </div>
  );
}
