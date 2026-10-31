// Shared paystub computation — mirrors the calc in /api/paystub/send so the
// recurring-paystub cron produces the same hours + gross without duplicating
// the money math ad-hoc. The send route stays authoritative at approval time;
// this drives the DRAFT that Toni reviews.

import { computeGrossForRateType, normalizePayCurrency, type PayCurrency, type PayRateHistoryRow } from "@/lib/payroll";
import { isPayrollEligible } from "@/lib/payrollHours";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export interface PaystubComputation {
  payRate: number;
  /** ms worked per local date (personal/clock-out excluded; break excluded for every VA after cutoff). */
  byDate: Record<string, number>;
  /** by_date carrying the per-day rate — the snapshot shape portal/print expect. */
  byDateWithRates: Record<string, { ms: number; rate: number }>;
  totalMs: number;
  totalHours: number;
  grossPay: number;      // time-based
  fixedTotal: number;    // fixed assignments + output-based tasks
  totalGrossPay: number; // grossPay + fixedTotal
  rateByDate: Record<string, number>;
  /** True for a flat monthly salary — grossPay is prorated by weekdays, not hours × rate. */
  isFixedPeriod: boolean;
  payRateType: string | null;
  currency: PayCurrency;
  /** Output Based Tasks counted in fixedTotal — saved on the draft as its picks. */
  outputItemIds: number[];
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
    .select("pay_rate, pay_rate_type, pay_currency, position")
    .eq("id", userId)
    .single();
  if (!vaProfile) return null;

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
    if (!isPayrollEligible(log, vaProfile.position)) continue;
    const dateKey = log.session_date || log.start_time.split("T")[0];
    const ms = Number(log.duration_ms);
    byDate[dateKey] = (byDate[dateKey] || 0) + ms;
    totalMs += ms;
  }

  const { data: rateHistoryRaw } = await admin
    .from("pay_rate_history")
    .select("rate_amount, rate_type, effective_date, end_date")
    .eq("user_id", userId)
    .order("effective_date", { ascending: false });
  // A monthly salary is prorated by weekdays in the period, not hours x rate.
  const { grossPay, rateByDate, isFixedPeriod } = computeGrossForRateType(
    byDate,
    (rateHistoryRaw ?? []) as PayRateHistoryRow[],
    payRate,
    vaProfile.pay_rate_type,
    startDate,
    endDate
  );

  // A salaried day has no meaningful per-day $ amount — leave it out of
  // byDateWithRates instead of falling back to payRate, which would draw it
  // as if payRate were an hourly price.
  const byDateWithRates: Record<string, { ms: number; rate: number }> = {};
  for (const [date, ms] of Object.entries(byDate)) {
    byDateWithRates[date] = { ms, rate: isFixedPeriod ? 0 : rateByDate[date] ?? payRate };
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

  // Output-based tasks: ALL unpaid work for the period (any status, carried-
  // over included), picked by default on the draft so its total shows what's
  // owed — Toni unticks anything that shouldn't be paid when she reviews it.
  // Same selection the send route makes (fetchUnpaidOutputTasks).
  const outputTasks = await fetchUnpaidOutputTasks(admin, userId, endDate);
  const fptTotal = outputTasks.reduce((s, t) => s + t.rate, 0);

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
    isFixedPeriod: Boolean(isFixedPeriod),
    payRateType: vaProfile.pay_rate_type ?? null,
    currency: normalizePayCurrency(vaProfile.pay_currency),
    outputItemIds: outputTasks.map((t) => t.id),
  };
}

/** The org's timezone — every date MinuteFlow shows is in org time. */
async function orgTimeZone(admin: AnySupabase): Promise<string> {
  const { data } = await admin.from("organization_settings").select("timezone").limit(1).maybeSingle();
  return data?.timezone || "UTC";
}

/**
 * When each Output Based Task (fixed_pay_tasks id) was FIRST submitted, as a
 * YYYY-MM-DD date in org time. Pay is by first submission: a revision is
 * included in the reel's rate, so later resubmissions and status changes
 * must not move the date. Submissions hang off the claimed task's
 * assigned_tasks mirror; a task never submitted is absent from the map.
 */
export async function fetchFirstSubmittedDates(
  admin: AnySupabase,
  fixedPayTaskIds: number[],
  timeZone?: string
): Promise<Map<number, string>> {
  const firstByTask = new Map<number, string>();
  const ids = [...new Set(fixedPayTaskIds)];
  if (ids.length === 0) return firstByTask;
  const { data: mirrors } = await admin
    .from("assigned_tasks")
    .select("id, fixed_pay_task_id")
    .in("fixed_pay_task_id", ids);
  const taskByMirror = new Map<number, number>(
    ((mirrors ?? []) as Array<{ id: number; fixed_pay_task_id: number | string }>).map((m) => [Number(m.id), Number(m.fixed_pay_task_id)])
  );
  if (taskByMirror.size === 0) return firstByTask;
  const { data: subs } = await admin
    .from("task_submissions")
    .select("assigned_task_id, created_at")
    .in("assigned_task_id", [...taskByMirror.keys()])
    .eq("message_type", "submission")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const tz = timeZone ?? (await orgTimeZone(admin));
  for (const s of (subs ?? []) as Array<{ assigned_task_id: number; created_at: string }>) {
    const taskId = taskByMirror.get(Number(s.assigned_task_id));
    if (taskId == null || firstByTask.has(taskId)) continue;
    // en-CA formats as YYYY-MM-DD.
    firstByTask.set(taskId, new Date(s.created_at).toLocaleDateString("en-CA", { timeZone: tz }));
  }
  return firstByTask;
}

export interface UnpaidOutputTask {
  id: number;
  task_name: string | null;
  task_detail: string | null;
  account: string | null;
  category: string | null;
  rate: number;
  status: string;
  updated_at: string | null;
  /** First submission, YYYY-MM-DD in org time; null if never submitted. */
  first_submitted: string | null;
}

/**
 * Output Based Tasks (fixed_pay_tasks) a VA has not been paid for that belong
 * on a paystub ending `endDate`: any status except cancelled, first submitted
 * by endDate (pay is by first submission — a revision is included in the
 * reel's rate), or, never submitted, last updated by endDate. Includes work
 * carried over from before the period, oldest first. Shared by the send route
 * and scheduled draft generation so both pick the same tasks.
 */
export async function fetchUnpaidOutputTasks(
  admin: AnySupabase,
  userId: string,
  endDate: string
): Promise<UnpaidOutputTask[]> {
  const { data } = await admin
    .from("fixed_pay_tasks")
    .select("id, task_name, task_detail, account, category, rate, status, updated_at")
    .eq("claimed_by", userId)
    .neq("status", "cancelled")
    .is("paid_at", null)
    .is("deleted_at", null);
  const rows = (data ?? []) as Array<{ id: number; task_name: string | null; task_detail: string | null; account: string | null; category: string | null; rate: number | string | null; status: string; updated_at: string | null }>;
  const firstSubmitted = await fetchFirstSubmittedDates(admin, rows.map((t) => t.id));
  const cutoffMs = new Date(`${endDate}T23:59:59.999`).getTime();
  return rows
    .filter((t) => {
      const first = firstSubmitted.get(t.id);
      if (first) return first <= endDate;
      const updated = t.updated_at ? new Date(t.updated_at).getTime() : NaN;
      return !Number.isNaN(updated) && updated <= cutoffMs;
    })
    .map((t) => ({ ...t, rate: Number(t.rate) || 0, first_submitted: firstSubmitted.get(t.id) ?? null }))
    .sort((a, b) => (a.first_submitted ?? "9999").localeCompare(b.first_submitted ?? "9999"));
}

export interface PaidOutputItem {
  id: number;
  task_name: string;
  account: string;
  amount: number;
  /** First submission date, in org time (e.g. "Sep 7, 2026"); null if never submitted. */
  submitted_label: string | null;
  /** The client memo — "Client Detail" on the Output Based Tasks table, kept
   *  in sync with the time-log memo by syncTaskDetailFromMemo. */
  client_memo: string | null;
}

/**
 * Output Based Tasks (fixed_pay_tasks) settled by each sent paystub, keyed by
 * pay period label. The send route stamps paid_period_label on exactly the
 * items that were checked in, and the snapshot itself doesn't store them —
 * so this is how history, print and resend show what the money was for.
 */
export async function fetchPaidOutputByLabel(
  admin: AnySupabase,
  userId: string,
  labels: string[]
): Promise<Map<string, PaidOutputItem[]>> {
  const byLabel = new Map<string, PaidOutputItem[]>();
  const wanted = [...new Set(labels.filter(Boolean))];
  if (wanted.length === 0) return byLabel;
  const { data } = await admin
    .from("fixed_pay_tasks")
    .select("id, task_name, task_detail, account, rate, paid_period_label, created_at")
    .eq("claimed_by", userId)
    .in("paid_period_label", wanted)
    .not("paid_at", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const tasks = (data ?? []) as Array<{ id: number; task_name: string | null; task_detail: string | null; account: string | null; rate: number | string | null; paid_period_label: string; created_at: string | null }>;
  const firstSubmitted = await fetchFirstSubmittedDates(admin, tasks.map((t) => t.id));

  // Listed in first-submission order; never-submitted tasks go last.
  const ordered = [...tasks].sort((a, b) =>
    (firstSubmitted.get(a.id) ?? "9999").localeCompare(firstSubmitted.get(b.id) ?? "9999")
  );
  for (const t of ordered) {
    const list = byLabel.get(t.paid_period_label) ?? [];
    const day = firstSubmitted.get(t.id);
    list.push({
      id: t.id,
      task_name: t.task_name ?? "Output Based Task",
      account: t.account ?? "",
      amount: Number(t.rate) || 0,
      submitted_label: day
        ? new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
        : null,
      client_memo: t.task_detail?.trim() || null,
    });
    byLabel.set(t.paid_period_label, list);
  }
  return byLabel;
}

export interface PeriodPayment {
  amount: number;
  payment_date: string | null;
  payment_method: string | null;
  confirmation_number: string | null;
  notes: string | null;
}

/**
 * Every va_payments row for a paystub's period, split into the one that
 * paystub's send recorded ("Paystub for <label>", at amount_paid) and the
 * rest — advances and earlier split payments — so a stub can show what was
 * sent before versus what it paid now, rather than one blended total.
 */
export async function fetchPeriodPayments(
  admin: AnySupabase,
  userId: string,
  snap: { period_start: string; period_end: string; pay_period_label: string; amount_paid: number | string | null }
): Promise<{ earlier: PeriodPayment[]; thisPaystub: PeriodPayment | null; total: number; hasRows: boolean }> {
  const { data } = await admin
    .from("va_payments")
    .select("amount, payment_date, payment_method, confirmation_number, notes, created_at")
    .eq("va_id", userId)
    .eq("period_start", snap.period_start)
    .eq("period_end", snap.period_end)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  return splitPeriodPayments(
    ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      amount: Number(p.amount || 0),
      payment_date: (p.payment_date as string | null) ?? null,
      payment_method: (p.payment_method as string | null) ?? null,
      confirmation_number: (p.confirmation_number as string | null) ?? null,
      notes: (p.notes as string | null) ?? null,
    })),
    snap
  );
}

export function splitPeriodPayments(
  payments: PeriodPayment[],
  snap: { pay_period_label: string; amount_paid: number | string | null }
): { earlier: PeriodPayment[]; thisPaystub: PeriodPayment | null; total: number; hasRows: boolean } {
  const amountPaid = Number(snap.amount_paid || 0);
  const ownNote = `Paystub for ${snap.pay_period_label}`;
  // Prefer the exact row (note + amount); if the stub's amount was edited
  // afterwards, fall back to the latest row carrying its note, so its own
  // payment is never counted again as "sent earlier".
  let ownIdx = -1;
  for (let i = payments.length - 1; i >= 0; i--) {
    if (payments[i].notes === ownNote && Math.abs(payments[i].amount - amountPaid) < 0.005) {
      ownIdx = i;
      break;
    }
  }
  if (ownIdx < 0) {
    for (let i = payments.length - 1; i >= 0; i--) {
      if (payments[i].notes === ownNote) {
        ownIdx = i;
        break;
      }
    }
  }
  return {
    earlier: payments.filter((_, i) => i !== ownIdx),
    thisPaystub: ownIdx >= 0 ? payments[ownIdx] : null,
    total: payments.reduce((sum, p) => sum + p.amount, 0),
    hasRows: payments.length > 0,
  };
}
