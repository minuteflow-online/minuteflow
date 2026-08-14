// Shared paystub computation — mirrors the calc in /api/paystub/send so the
// recurring-paystub cron produces the same hours + gross without duplicating
// the money math ad-hoc. The send route stays authoritative at approval time;
// this drives the DRAFT that Toni reviews.

import { computeHourlyGross, type PayRateHistoryRow } from "@/lib/payroll";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

const BREAK_EXCLUSION_DATE = "2026-07-06";

export interface PaystubComputation {
  payRate: number;
  /** ms worked per local date (personal/clock-out excluded; break excluded for full-timers after cutoff). */
  byDate: Record<string, number>;
  /** by_date carrying the per-day rate — the snapshot shape portal/print expect. */
  byDateWithRates: Record<string, { ms: number; rate: number }>;
  totalMs: number;
  totalHours: number;
  grossPay: number;      // time-based
  fixedTotal: number;    // fixed assignments + output-based tasks
  totalGrossPay: number; // grossPay + fixedTotal
  rateByDate: Record<string, number>;
}

/** Compute a VA's paystub numbers for [startDate, endDate] (inclusive, session_date). */
export async function computePaystubData(
  admin: AnySupabase,
  userId: string,
  startDate: string,
  endDate: string
): Promise<PaystubComputation | null> {
  const { data: vaProfile } = await admin
    .from("profiles")
    .select("pay_rate, position")
    .eq("id", userId)
    .single();
  if (!vaProfile) return null;

  const isFullTimeVa = vaProfile.position === "Full-time VA";
  const payRate = Number(vaProfile.pay_rate) || 0;

  const { data: logs } = await admin
    .from("time_logs")
    .select("start_time, duration_ms, category, session_date")
    .eq("user_id", userId)
    .gte("session_date", startDate)
    .lte("session_date", endDate)
    .is("deleted_at", null);

  const byDate: Record<string, number> = {};
  let totalMs = 0;
  for (const log of (logs ?? []) as { start_time: string; duration_ms: number; category: string | null; session_date: string | null }[]) {
    if (!log.duration_ms) continue;
    const category = String(log.category ?? "").trim().toLowerCase();
    if (category === "personal" || category === "clock out") continue;
    const dateKey = log.session_date || log.start_time.split("T")[0];
    if (category === "break" && isFullTimeVa && dateKey >= BREAK_EXCLUSION_DATE) continue;
    const ms = Number(log.duration_ms);
    byDate[dateKey] = (byDate[dateKey] || 0) + ms;
    totalMs += ms;
  }

  const { data: rateHistoryRaw } = await admin
    .from("pay_rate_history")
    .select("rate_amount, rate_type, effective_date, end_date")
    .eq("user_id", userId)
    .order("effective_date", { ascending: false });
  const { grossPay, rateByDate } = computeHourlyGross(
    byDate,
    (rateHistoryRaw ?? []) as PayRateHistoryRow[],
    payRate
  );

  const byDateWithRates: Record<string, { ms: number; rate: number }> = {};
  for (const [date, ms] of Object.entries(byDate)) {
    byDateWithRates[date] = { ms, rate: rateByDate[date] ?? payRate };
  }

  // Fixed-rate assignments (approved/completed, not yet paid)
  const { data: fixedRaw } = await admin
    .from("va_task_assignments")
    .select("rate, quantity_claimed, status")
    .eq("va_id", userId)
    .eq("billing_type", "fixed")
    .in("status", ["approved", "completed"]);
  const fixedAssignTotal = ((fixedRaw ?? []) as { rate: number; quantity_claimed: number }[]).reduce(
    (s, a) => s + (Number(a.rate) || 0) * (Number(a.quantity_claimed) || 1),
    0
  );

  // Output-based tasks (completed, not yet paid)
  const { data: fptRaw } = await admin
    .from("fixed_pay_tasks")
    .select("rate")
    .eq("claimed_by", userId)
    .eq("status", "completed")
    .is("deleted_at", null);
  const fptTotal = ((fptRaw ?? []) as { rate: number }[]).reduce((s, t) => s + (Number(t.rate) || 0), 0);

  const fixedTotal = fixedAssignTotal + fptTotal;
  const totalHours = totalMs / 3_600_000;

  return {
    payRate,
    byDate,
    byDateWithRates,
    totalMs,
    totalHours,
    grossPay,
    fixedTotal,
    totalGrossPay: grossPay + fixedTotal,
    rateByDate,
  };
}
