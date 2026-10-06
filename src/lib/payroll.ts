/**
 * Shared payroll calculation — the ONE place hourly gross pay is computed.
 * Rate history aware: each logged day is paid at the pay_rate_history row
 * covering that day (effective_date <= day <= end_date, end_date NULL = open).
 * Do not add another ad-hoc hours*rate path — route it through here
 * (same rule as the invoice shared-subtotal function, CRM ticket 7dbc63e8).
 */

export type PayRateType = "hourly" | "daily" | "monthly" | "per_task";

export interface PayRateHistoryRow {
  rate_amount: number | string;
  effective_date: string; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD or null for the current open rate
  /** Absent on older rows, which were all hourly. */
  rate_type?: PayRateType | string | null;
}

/**
 * Is this rate a flat amount for the period rather than a price per hour?
 *
 * A monthly salary is the whole point of this: it does not get multiplied by
 * anything. Paying $4,000/month for two logged hours is $4,000, not $8,000.
 */
export function isFixedPeriodRate(rateType?: PayRateType | string | null): boolean {
  return rateType === "monthly";
}

/**
 * Hourly equivalent of a rate, for the paths that genuinely need one (budget
 * estimates, cost-per-hour views). A daily rate assumes an 8-hour day and a
 * monthly rate a 160-hour month — the same conversion FinancialSummaryTab has
 * always used. Not used for computing what someone is actually paid.
 */
export function toHourlyRate(amount: number, rateType?: PayRateType | string | null): number {
  if (rateType === "daily") return amount / 8;
  if (rateType === "monthly") return amount / 160;
  return amount;
}

export interface RateSegment {
  rate: number;
  ms: number;
  hours: number;
  amount: number;
}

export interface HourlyGrossResult {
  grossPay: number;
  /** Chronological segments of the period, one per distinct rate. */
  segments: RateSegment[];
  /** Rate applied to each logged date. */
  rateByDate: Record<string, number>;
  /** True for a flat monthly salary — grossPay is not hours × a per-hour
   * rate, so callers must not show a per-day $ amount or a "$/hr" label. */
  isFixedPeriod?: boolean;
  /** Set only when isFixedPeriod: the weekday counts behind the proration
   * fraction, so a paystub can show its own math ("15 of 21 weekdays"). */
  periodWeekdays?: number;
  monthWeekdays?: number;
}

/** Count of Mon–Fri dates in [start, end] inclusive (YYYY-MM-DD, UTC-safe). */
export function weekdaysInRange(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let count = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Weekday count for the whole calendar month containing `dateInMonth`. */
export function weekdaysInMonth(dateInMonth: string): number {
  const d = new Date(dateInMonth + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return weekdaysInRange(first, last);
}

/** Snapshot by_date value: legacy plain ms number, or {ms, rate} going forward. */
export type ByDateValue = number | { ms: number; rate?: number };

/** Rate in effect on a YYYY-MM-DD date, falling back to the profile rate. */
export function rateForDate(
  date: string,
  history: PayRateHistoryRow[],
  fallbackRate: number
): number {
  for (const row of history) {
    if (
      row.effective_date <= date &&
      (row.end_date == null || date <= row.end_date)
    ) {
      const rate = Number(row.rate_amount);
      if (!isNaN(rate)) return rate;
    }
  }
  return fallbackRate;
}

/**
 * Compute hourly gross pay from per-day logged ms, splitting the period
 * across rate changes. E.g. 36h @ $18 + 30h @ $22 = $1308, not 66h at one rate.
 *
 * HOURS-BASED RATES ONLY. Pass a monthly salary in here and it is treated as a
 * price per hour — which is exactly the bug this warning exists to prevent.
 * For a monthly rate use computeGrossForRateType, which pays the flat amount.
 */
export function computeHourlyGross(
  byDateMs: Record<string, number>,
  history: PayRateHistoryRow[],
  fallbackRate: number
): HourlyGrossResult {
  const rateByDate: Record<string, number> = {};
  const msByRate = new Map<number, number>();

  for (const [date, ms] of Object.entries(byDateMs).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const rate = rateForDate(date, history, fallbackRate);
    rateByDate[date] = rate;
    msByRate.set(rate, (msByRate.get(rate) || 0) + Number(ms));
  }

  let grossPay = 0;
  const segments: RateSegment[] = [];
  for (const [rate, ms] of msByRate) {
    const hours = ms / 3_600_000;
    const amount = hours * rate;
    grossPay += amount;
    segments.push({ rate, ms, hours, amount });
  }

  return { grossPay, segments, rateByDate };
}

/**
 * Gross pay for a period, respecting how the rate is actually charged.
 *
 * A monthly rate is NEVER hours × a per-hour price — multiplying gave $8,000
 * for a $4,000 salary. It is prorated instead, by how much of the month's
 * working days this specific period covers: a VA who started mid-month, or
 * whose paystub period is a partial one, gets that fraction of the salary; a
 * full-month period gets all of it. `periodStart`/`periodEnd` decide both the
 * fraction's numerator (weekdays in the period) and which calendar month's
 * weekday count is the denominator.
 *
 * Hours are still counted and reported; they just are not what the pay is
 * derived from here.
 *
 * Everything else falls through to the hours-based calculation unchanged.
 */
export function computeGrossForRateType(
  byDateMs: Record<string, number>,
  history: PayRateHistoryRow[],
  fallbackRate: number,
  rateType: PayRateType | string | null | undefined,
  periodStart: string,
  periodEnd: string
): HourlyGrossResult {
  if (!isFixedPeriodRate(rateType)) {
    return computeHourlyGross(byDateMs, history, fallbackRate);
  }

  const periodWeekdays = weekdaysInRange(periodStart, periodEnd);
  const monthWeekdays = weekdaysInMonth(periodStart);
  const grossPay = monthWeekdays > 0 ? fallbackRate * (periodWeekdays / monthWeekdays) : 0;

  // No segments and no per-day rate: a salary isn't attributed to any one
  // logged day, so there is nothing meaningful to show in a daily breakdown.
  return { grossPay, segments: [], rateByDate: {}, isFixedPeriod: true, periodWeekdays, monthWeekdays };
}

const RATE_SUFFIX: Record<string, string> = {
  hourly: "/hr",
  daily: "/day",
  monthly: "/mo",
  per_task: "/task",
};

/**
 * A pay rate with the unit it is actually charged in — "$300.00/mo", not
 * "$300.00/hr". Screens that assumed hourly displayed a monthly salary as an
 * hourly price, which reads as a VA costing hundreds of dollars an hour.
 */
export function formatPayRate(amount: number, rateType?: PayRateType | string | null, currency?: string | null): string {
  return `${formatPayMoney(amount, currency)}${RATE_SUFFIX[String(rateType ?? "hourly")] ?? "/hr"}`;
}

/** "36.00h @ $18.00/hr + 30.00h @ $22.00/hr" */
export function formatRateSegments(segments: RateSegment[], currency?: string | null): string {
  return segments
    .map((s) => `${s.hours.toFixed(2)}h @ ${formatPayMoney(s.rate, currency)}/hr`)
    .join(" + ");
}

/** Normalize a snapshot by_date entry (legacy number or {ms, rate}). */
export function normalizeByDateValue(
  value: ByDateValue,
  fallbackRate: number | null
): { ms: number; rate: number | null } {
  if (typeof value === "number") return { ms: value, rate: fallbackRate };
  return { ms: Number(value?.ms) || 0, rate: value?.rate ?? fallbackRate };
}

/**
 * The currency a VA is paid in (profiles.pay_currency), carried onto each
 * paystub snapshot (paystub_snapshots.currency) so a stub already sent keeps
 * its symbol even if the VA's setting changes later. Symbol only — amounts
 * are entered in that currency, never converted.
 */
export type PayCurrency = "USD" | "PHP";
export const PAY_CURRENCIES: PayCurrency[] = ["USD", "PHP"];

/** Anything unset or unrecognized is USD — every row before this setting existed. */
export function normalizePayCurrency(currency?: string | null): PayCurrency {
  return currency === "PHP" ? "PHP" : "USD";
}

/** "$" or "₱" — for input prefixes and labels. */
export function payCurrencySymbol(currency?: string | null): string {
  return normalizePayCurrency(currency) === "PHP" ? "₱" : "$";
}

/** "$1,234.50" or "₱1,234.50" */
export function formatPayMoney(amount: number, currency?: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizePayCurrency(currency),
  }).format(amount);
}

/**
 * A total across VAs paid in different currencies — pesos and dollars can't be
 * added together, so each currency is summed on its own: "$120.00 + ₱8,500.00".
 */
export function formatPayTotals(items: { amount: number; currency?: string | null }[]): string {
  const totals = new Map<PayCurrency, number>();
  for (const { amount, currency } of items) {
    const c = normalizePayCurrency(currency);
    totals.set(c, (totals.get(c) ?? 0) + amount);
  }
  if (totals.size === 0) return formatPayMoney(0);
  return [...totals].map(([c, n]) => formatPayMoney(n, c)).join(" + ");
}

/**
 * Financials are always in dollars. An amount in a VA's pay currency becomes
 * USD by dividing pesos by the pesos-per-dollar rate — the rate saved on that
 * payment when there is one (va_payments.exchange_rate), otherwise the org
 * default (organization_settings.php_per_usd). A peso amount with no usable
 * rate returns null: it can't be counted in dollars, and guessing would be
 * worse than saying so.
 */
export function toUsd(amount: number, currency?: string | null, phpPerUsd?: number | null): number | null {
  if (normalizePayCurrency(currency) === "USD") return amount;
  const rate = Number(phpPerUsd);
  return Number.isFinite(rate) && rate > 0 ? amount / rate : null;
}

/**
 * An output-based task is priced in the currency of whoever it belongs to:
 * the VA who claimed it, else the VA it's assigned to, else whoever created
 * it. So the same task reads ₱ for a peso-paid VA and $ for a dollar one.
 */
export function taskPayCurrency(task: {
  claimed_by_profile?: { pay_currency?: string | null } | null;
  assigned_to_profile?: { pay_currency?: string | null } | null;
  created_by_profile?: { pay_currency?: string | null } | null;
}): PayCurrency {
  const owner = task.claimed_by_profile ?? task.assigned_to_profile ?? task.created_by_profile;
  return normalizePayCurrency(owner?.pay_currency);
}

/** " (₱150.00 @ ₱58.5/$1)" for a peso processing fee's expense description, "" otherwise. */
export function processingFeePesoNote(fee: number, currency?: string | null, phpPerUsd?: number | null): string {
  if (normalizePayCurrency(currency) !== "PHP" || !phpPerUsd) return "";
  return ` (${formatPayMoney(fee, "PHP")} @ ₱${phpPerUsd}/$1)`;
}

/** "₱5,000.00 ≈ $85.47" for a peso amount once a rate is known; otherwise the amount in its own currency. */
export function formatPayWithUsd(amount: number, currency?: string | null, phpPerUsd?: number | null): string {
  const base = formatPayMoney(amount, currency);
  if (normalizePayCurrency(currency) !== "PHP") return base;
  const usd = toUsd(amount, "PHP", phpPerUsd);
  return usd == null ? base : `${base} ≈ ${formatPayMoney(usd, "USD")}`;
}

/**
 * One dollar total across VAs, converting pesos at phpPerUsd. With no rate a
 * peso amount can't be counted in dollars, so it falls back to per-currency
 * totals ("$120.00 + ₱8,500.00") rather than guess.
 */
export function formatPayTotalUsd(items: { amount: number; currency?: string | null }[], phpPerUsd?: number | null): string {
  let sum = 0;
  for (const { amount, currency } of items) {
    const usd = toUsd(amount, currency, phpPerUsd);
    if (usd == null) return formatPayTotals(items);
    sum += usd;
  }
  return formatPayMoney(sum, "USD");
}

/** A positive pesos-per-dollar rate, or null. */
export function parsePhpPerUsd(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
}
