"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shiftHoursFromProfile, computeBudgetStatus, vaBudgetType, type BudgetStatus } from "@/lib/budget";
import type { BudgetRequest } from "@/types/database";

type BudgetProfile = {
  position: string | null;
  pay_rate_type: string | null;
  shift_hours: number | null;
  shift_start: string | null;
  shift_end: string | null;
  daily_budget_limit: number | null;
  weekly_budget_limit: number | null;
  monthly_budget_limit: number | null;
};

function startOfTodayISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

// Week starts Sunday, matching Calendar's buildWeekGrid.
function startOfWeekISO(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString();
}

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

function formatAmount(value: number, unit: "hours" | "dollars"): string {
  return unit === "dollars" ? `$${value.toFixed(2)}` : `${value.toFixed(2)}h`;
}

export default function BudgetWidget({ currentUserId, refreshKey = 0, bare = false }: { currentUserId: string; refreshKey?: number; bare?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [dailyUsed, setDailyUsed] = useState(0);
  const [weeklyUsed, setWeeklyUsed] = useState(0);
  const [monthlyUsed, setMonthlyUsed] = useState(0);
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [requestAmount, setRequestAmount] = useState("");
  const [requestReason, setRequestReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: prof }, { data: logs }, reqRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("position, pay_rate_type, shift_hours, shift_start, shift_end, daily_budget_limit, weekly_budget_limit, monthly_budget_limit")
          .eq("id", currentUserId)
          .single(),
        // Pull from whichever is earlier, week-start or month-start (a week
        // can start in the previous month) — today's and this week's totals
        // are just subsets of this same result, so one query covers all three.
        supabase
          .from("time_logs")
          .select("duration_ms, start_time, end_time, billing_type, task_rate")
          .eq("user_id", currentUserId)
          .gte("start_time", new Date(Math.min(new Date(startOfWeekISO()).getTime(), new Date(startOfMonthISO()).getTime())).toISOString()),
        fetch("/api/budget-requests", { cache: "no-store" }),
      ]);

      const p = (prof as BudgetProfile | null) ?? null;
      setProfile(p);

      const type = p ? vaBudgetType(p) : "time_based";
      const now = Date.now();
      const todayStartMs = new Date(startOfTodayISO()).getTime();
      const weekStartMs = new Date(startOfWeekISO()).getTime();
      const monthStartMs = new Date(startOfMonthISO()).getTime();

      let daily = 0;
      let weekly = 0;
      let monthly = 0;
      for (const log of (logs ?? []) as { duration_ms: number | null; start_time: string | null; end_time: string | null; billing_type: string | null; task_rate: number | null }[]) {
        const startMs = log.start_time ? new Date(log.start_time).getTime() : null;
        const isToday = startMs != null && startMs >= todayStartMs;
        const isThisWeek = startMs != null && startMs >= weekStartMs;
        const isThisMonth = startMs != null && startMs >= monthStartMs;
        let amount: number;
        if (type === "output_based") {
          // Output Based VAs are tracked in dollars — sum the task_rate of
          // their fixed-price logs (task_rate is the whole task's price, set
          // once when that log was created, not a per-hour rate).
          if (log.billing_type !== "fixed" || !log.task_rate) continue;
          amount = log.task_rate;
        } else {
          // Time-based VAs are tracked in hours worked.
          let ms = log.duration_ms && log.duration_ms > 0 ? log.duration_ms : 0;
          if (!log.end_time && log.start_time) {
            const elapsed = now - new Date(log.start_time).getTime();
            ms = elapsed > 0 ? elapsed : 0;
          }
          amount = ms / 3_600_000;
        }
        if (isThisMonth) monthly += amount;
        if (isThisWeek) weekly += amount;
        if (isToday) daily += amount;
      }
      setDailyUsed(daily);
      setWeeklyUsed(weekly);
      setMonthlyUsed(monthly);

      if (reqRes.ok) {
        const json = await reqRes.json();
        setRequests((json.requests ?? []) as BudgetRequest[]);
      }
    } catch {
      setError("Couldn't load your budget right now.");
    } finally {
      setLoading(false);
    }
  }, [supabase, currentUserId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const budgetType = profile ? vaBudgetType(profile) : "time_based";
  const unit: "hours" | "dollars" = budgetType === "output_based" ? "dollars" : "hours";

  // Approved requests only count toward the day they were actually approved on —
  // otherwise an old approval would silently keep padding every future day's
  // budget forever instead of being a one-time exception for that day. Only
  // the daily period is request/grant-able; monthly is read-only.
  const approvedTodayTotal = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return requests
      .filter((r) => r.status === "approved" && r.reviewed_at && new Date(r.reviewed_at) >= todayStart)
      .reduce((sum, r) => sum + Number(r.amount), 0);
  }, [requests]);

  const dailyLimit = profile ? (budgetType === "output_based" ? profile.daily_budget_limit : shiftHoursFromProfile(profile)) : null;
  const dailyStatus: BudgetStatus | null = computeBudgetStatus(dailyLimit, dailyUsed, unit, approvedTodayTotal);
  const weeklyStatus: BudgetStatus | null = computeBudgetStatus(profile?.weekly_budget_limit ?? null, weeklyUsed, unit);
  const monthlyStatus: BudgetStatus | null = computeBudgetStatus(profile?.monthly_budget_limit ?? null, monthlyUsed, unit);

  // A request can be offered whenever ANY period is at/over its limit — not just
  // the daily one — so being over the weekly or monthly budget surfaces it too.
  const anyOverOrWarn = Boolean(
    (dailyStatus && (dailyStatus.warn || dailyStatus.over)) ||
    (weeklyStatus && (weeklyStatus.warn || weeklyStatus.over)) ||
    (monthlyStatus && (monthlyStatus.warn || monthlyStatus.over))
  );

  const pendingRequest = requests.find((r) => r.status === "pending");

  const submitRequest = useCallback(async () => {
    const amount = Number(requestAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter how much more budget you need.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/budget-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, unit, reason: requestReason.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setShowRequest(false);
      setRequestAmount("");
      setRequestReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your request.");
    } finally {
      setSubmitting(false);
    }
  }, [requestAmount, requestReason, unit, load]);

  // No limits configured at all → nothing to show. In the standalone card
  // that means stay out of the way entirely; inside the tabbed container the
  // tab itself is still a deliberate choice, so it gets an explanation instead.
  const hasAnyLimit = Boolean(dailyStatus || weeklyStatus || monthlyStatus);
  if (!loading && !hasAnyLimit && !bare) return null;

  function PeriodSection({ label, status }: { label: string; status: BudgetStatus | null }) {
    if (!status) {
      return (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut mb-1">{label}</p>
          <p className="text-[11px] text-stone italic">No limit set.</p>
        </div>
      );
    }
    const barColor = status.over ? "bg-terracotta" : status.warn ? "bg-amber" : "bg-sage";
    const pct = Math.min(100, Math.round(status.fraction * 100));
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-walnut">{label}</p>
          <span className="text-[11px] font-semibold text-walnut">{formatAmount(status.remaining, status.unit)} left</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-parchment">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-stone">
          <span>{formatAmount(status.used, status.unit)} used</span>
          <span>
            {formatAmount(status.limit, status.unit)} limit
            {label === "Daily Limit" && approvedTodayTotal > 0 ? ` (+${formatAmount(approvedTodayTotal, status.unit)} approved today)` : ""}
          </span>
        </div>
        {status.over ? (
          <p className="text-[11px] font-semibold text-terracotta">Over {label.toLowerCase()}.</p>
        ) : status.warn ? (
          <p className="text-[11px] font-semibold text-amber">At {pct}% — should wrap up soon.</p>
        ) : null}
      </div>
    );
  }

  const content = (
    <>
      {!bare && <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Budget and Limit</h3>}

      {loading ? (
        <p className="text-[11px] text-stone">Loading…</p>
      ) : hasAnyLimit ? (
        <>
          <PeriodSection label="Daily Limit" status={dailyStatus} />
          <div className="border-t border-parchment" />
          <PeriodSection label="Weekly Limit" status={weeklyStatus} />
          <div className="border-t border-parchment" />
          <PeriodSection label="Monthly Budget" status={monthlyStatus} />

          {(pendingRequest ? (
            <p className="rounded-lg bg-amber-soft/60 px-2.5 py-1.5 text-[11px] text-walnut">
              Request for {formatAmount(pendingRequest.amount, pendingRequest.unit)} more is pending admin approval.
            </p>
          ) : showRequest ? (
            <div className="space-y-2 rounded-lg border border-sand bg-parchment/30 p-2.5">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">Extra budget ({unit})</label>
                <input
                  type="number"
                  min="0"
                  step={unit === "dollars" ? "0.01" : "0.25"}
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(e.target.value)}
                  placeholder={unit === "dollars" ? "e.g. 20" : "e.g. 2"}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">Reason (optional)</label>
                <input
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="Why you need more time/budget"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void submitRequest()}
                  disabled={submitting}
                  className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/90 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send Request"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRequest(false)}
                  className="rounded-lg bg-stone/10 px-3 py-1 text-[10px] font-semibold text-stone hover:bg-stone/20"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            anyOverOrWarn && (
              <button
                type="button"
                onClick={() => setShowRequest(true)}
                className="w-full rounded-lg border border-terracotta/40 bg-terracotta-soft px-3 py-1.5 text-[11px] font-semibold text-terracotta hover:bg-terracotta-soft/70"
              >
                Request more budget
              </button>
            )
          ))}
        </>
      ) : bare ? (
        <p className="text-[11px] text-stone italic">No limit set — nothing to track yet.</p>
      ) : null}

      {error && <p className="text-[11px] text-terracotta">{error}</p>}
    </>
  );

  if (bare) return <div className="space-y-3">{content}</div>;
  return <div className="rounded-xl border border-sand bg-white p-3 space-y-3">{content}</div>;
}
