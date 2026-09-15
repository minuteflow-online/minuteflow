// Shared recurring-expense generation, used by /api/cron/generate-recurring-expenses.
// Mirrors the shape of runRecurringInvoiceGeneration (lib/invoiceGeneration.ts): one
// shared function, cron calls it monthly on the 1st.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

export interface ExpenseGenResult {
  generated: number;
  skipped: number;
}

/** Same day-of-month next month, clamped to that month's real last day (e.g. Jan 31 -> Feb 28). */
function addOneMonthClamped(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate();
  const clampedDay = Math.min(d, daysInNextMonth);
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * For every recurring expense series, generates the next month's occurrence
 * once the latest occurrence is from a prior calendar month — so running this
 * more than once in the same month is a no-op, not a duplicate.
 */
export async function runRecurringExpenseGeneration(admin: AnySupabase): Promise<ExpenseGenResult> {
  const { data: rows } = await admin
    .from("financial_expenses")
    .select("id, account, description, amount, category, is_reimbursable, expense_date, is_recurring, recurrence_source_id, recurrence_end_date")
    .eq("is_recurring", true);

  const all = (rows ?? []) as {
    id: number; account: string | null; description: string; amount: number; category: string | null;
    is_reimbursable: boolean | null; expense_date: string; is_recurring: boolean;
    recurrence_source_id: number | null; recurrence_end_date: string | null;
  }[];

  // Group into series by root id (a generated row's recurrence_source_id, or
  // its own id if it's the original) and take the latest occurrence in each.
  const latestBySeriesRoot = new Map<number, (typeof all)[number]>();
  for (const row of all) {
    const rootId = row.recurrence_source_id ?? row.id;
    const current = latestBySeriesRoot.get(rootId);
    if (!current || row.expense_date > current.expense_date) {
      latestBySeriesRoot.set(rootId, row);
    }
  }

  const todayIso = new Date().toISOString().split("T")[0];
  const currentMonthKey = todayIso.slice(0, 7); // "YYYY-MM"

  let generated = 0;
  let skipped = 0;

  for (const [rootId, latest] of latestBySeriesRoot) {
    if (latest.expense_date.slice(0, 7) >= currentMonthKey) {
      // Already has an occurrence this month (or somehow dated in the future) — nothing to do.
      skipped++;
      continue;
    }

    const nextDate = addOneMonthClamped(latest.expense_date);
    if (latest.recurrence_end_date && nextDate > latest.recurrence_end_date) {
      skipped++;
      continue;
    }

    const { error } = await admin.from("financial_expenses").insert({
      account: latest.account,
      description: latest.description,
      amount: latest.amount,
      expense_date: nextDate,
      category: latest.category,
      is_reimbursable: latest.is_reimbursable ?? false,
      reimbursed: false,
      date_recorded: todayIso,
      is_recurring: true,
      recurrence_source_id: rootId,
      recurrence_end_date: latest.recurrence_end_date,
    });
    if (error) {
      skipped++;
      continue;
    }
    generated++;
  }

  return { generated, skipped };
}
