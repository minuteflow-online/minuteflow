import { normalizePosition } from "@/types/database";

/**
 * The one place that decides which logged minutes a VA gets PAID for.
 *
 * This is NOT the same question as the `billable` column, which tracks what's
 * billable to a CLIENT for invoicing. Clock In / Planning time is
 * billable:false but still payable — a VA gets paid for it even though no
 * client is billed for it. Confusing the two silently dropped real paid time
 * from Team/Reports/Financials pages while the real paystub kept paying it.
 *
 * Mirrors computePaystubData in lib/paystub.ts exactly, since that function
 * is what actually generates pay — every other display of "how many hours
 * does this person get paid for" must match it or it's just lying with more
 * steps.
 */
export const PAYROLL_BREAK_EXCLUSION_DATE = "2026-07-06";

export interface PayrollLog {
  duration_ms: number | null;
  category: string | null;
  session_date?: string | null;
  start_time: string;
}

export function isPayrollEligible(
  log: PayrollLog,
  position: string | null | undefined
): boolean {
  if (!log.duration_ms) return false;
  const category = (log.category || "").trim().toLowerCase();
  if (category === "personal" || category === "clock out") return false;
  if (category === "break" && normalizePosition(position) === "Full Time") {
    const dateKey = log.session_date || log.start_time.split("T")[0];
    if (dateKey >= PAYROLL_BREAK_EXCLUSION_DATE) return false;
  }
  return true;
}

export function sumPayrollMs<T extends PayrollLog>(
  logs: T[],
  position: string | null | undefined
): number {
  return logs.reduce(
    (sum, log) => (isPayrollEligible(log, position) ? sum + (log.duration_ms || 0) : sum),
    0
  );
}
