"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shiftHoursFromProfile, computeBudgetStatus, type BudgetStatus } from "@/lib/budget";
import type { BudgetRequest } from "@/types/database";

type BudgetProfile = {
  shift_hours: number | null;
  shift_start: string | null;
  shift_end: string | null;
  daily_budget_unit: "hours" | "dollars" | null;
  pay_rate: number | null;
};

function startOfTodayISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

function formatAmount(value: number, unit: "hours" | "dollars"): string {
  return unit === "dollars" ? `$${value.toFixed(2)}` : `${value.toFixed(2)}h`;
}

export default function BudgetWidget({ currentUserId, refreshKey = 0 }: { currentUserId: string; refreshKey?: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<BudgetProfile | null>(null);
  const [workedHours, setWorkedHours] = useState(0);
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
          .select("shift_hours, shift_start, shift_end, daily_budget_unit, pay_rate")
          .eq("id", currentUserId)
          .single(),
        supabase
          .from("time_logs")
          .select("duration_ms, start_time, end_time")
          .eq("user_id", currentUserId)
          .gte("start_time", startOfTodayISO()),
        fetch("/api/budget-requests", { cache: "no-store" }),
      ]);

      setProfile((prof as BudgetProfile | null) ?? null);

      const now = Date.now();
      const totalMs = (logs ?? []).reduce((sum: number, log: { duration_ms: number | null; start_time: string | null; end_time: string | null }) => {
        if (log.duration_ms && log.duration_ms > 0) return sum + log.duration_ms;
        // Open log (running) — count elapsed time so the budget reflects the
        // task in progress, not just closed ones.
        if (!log.end_time && log.start_time) {
          const elapsed = now - new Date(log.start_time).getTime();
          return sum + (elapsed > 0 ? elapsed : 0);
        }
        return sum;
      }, 0);
      setWorkedHours(totalMs / 3_600_000);

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

  const status: BudgetStatus | null = useMemo(() => {
    if (!profile) return null;
    const shiftHours = shiftHoursFromProfile(profile);
    const unit = profile.daily_budget_unit ?? "hours";
    return computeBudgetStatus(shiftHours, workedHours, unit, profile.pay_rate);
  }, [profile, workedHours]);

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
        body: JSON.stringify({ amount, unit: status?.unit ?? "hours", reason: requestReason.trim() || null }),
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
  }, [requestAmount, requestReason, status, load]);

  // No shift configured → no budget to show. Stay out of the way.
  if (!loading && !status) return null;

  const barColor = status?.over ? "bg-terracotta" : status?.warn ? "bg-amber" : "bg-sage";
  const pct = status ? Math.min(100, Math.round(status.fraction * 100)) : 0;

  return (
    <div className="rounded-xl border border-sand bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">Daily Budget</h3>
        {status && (
          <span className="text-[11px] font-semibold text-walnut">
            {formatAmount(status.remaining, status.unit)} left
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-stone">Loading…</p>
      ) : status ? (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-parchment">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-stone">
            <span>{formatAmount(status.used, status.unit)} used</span>
            <span>{formatAmount(status.limit, status.unit)} shift</span>
          </div>

          {status.over ? (
            <p className="text-[11px] font-semibold text-terracotta">Over your daily budget.</p>
          ) : status.warn ? (
            <p className="text-[11px] font-semibold text-amber">You&apos;re at {pct}% — should wrap up soon.</p>
          ) : null}

          {pendingRequest ? (
            <p className="rounded-lg bg-amber-soft/60 px-2.5 py-1.5 text-[11px] text-walnut">
              Request for {formatAmount(pendingRequest.amount, pendingRequest.unit)} more is pending admin approval.
            </p>
          ) : showRequest ? (
            <div className="space-y-2 rounded-lg border border-sand bg-parchment/30 p-2.5">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-walnut">Extra budget ({status.unit})</label>
                <input
                  type="number"
                  min="0"
                  step={status.unit === "dollars" ? "0.01" : "0.25"}
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(e.target.value)}
                  placeholder={status.unit === "dollars" ? "e.g. 20" : "e.g. 2"}
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
            (status.warn || status.over) && (
              <button
                type="button"
                onClick={() => setShowRequest(true)}
                className="w-full rounded-lg border border-terracotta/40 bg-terracotta-soft px-3 py-1.5 text-[11px] font-semibold text-terracotta hover:bg-terracotta-soft/70"
              >
                Request more budget
              </button>
            )
          )}
        </>
      ) : null}

      {error && <p className="text-[11px] text-terracotta">{error}</p>}
    </div>
  );
}
