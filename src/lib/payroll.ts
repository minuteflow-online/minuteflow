/**
 * Shared payroll calculation — the ONE place hourly gross pay is computed.
 * Rate history aware: each logged day is paid at the pay_rate_history row
 * covering that day (effective_date <= day <= end_date, end_date NULL = open).
 * Do not add another ad-hoc hours*rate path — route it through here
 * (same rule as the invoice shared-subtotal function, CRM ticket 7dbc63e8).
 */

export interface PayRateHistoryRow {
  rate_amount: number | string;
  effective_date: string; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD or null for the current open rate
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

/** "36.00h @ $18.00/hr + 30.00h @ $22.00/hr" */
export function formatRateSegments(segments: RateSegment[]): string {
  return segments
    .map((s) => `${s.hours.toFixed(2)}h @ ${formatUsd(s.rate)}/hr`)
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

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
