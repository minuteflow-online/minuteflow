"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * How much of a team member's overall hour budget has been handed out to
 * specific accounts, and how much is still unspoken for.
 *
 * The per-account budgets live on va_account_assignments; the overall limit is
 * the member's own weekly/monthly budget. Assigned is the sum of the per-account
 * numbers, remaining is limit minus assigned. Over-assigning is allowed and
 * called out rather than blocked — nothing enforces these budgets yet, so the
 * honest thing is to show the arithmetic and let a human decide.
 *
 * Rendered identically in the admin profile card and the member's own portal;
 * it is read-only on both, since the numbers it sums are edited elsewhere.
 */

type Row = {
  accountName: string;
  inherited: boolean;
  weekly_hours_budget: number | null;
  monthly_hours_budget: number | null;
};

function Line({
  label,
  limit,
  assigned,
}: {
  label: string;
  limit: number | null;
  assigned: number;
}) {
  const hasLimit = limit != null && limit > 0;
  const remaining = hasLimit ? limit - assigned : null;
  const over = remaining != null && remaining < 0;
  const pct = hasLimit ? Math.min((assigned / limit) * 100, 100) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-bark">{label}</span>
        <span className="text-[11px] text-espresso">
          <strong>{assigned}h</strong>
          <span className="text-bark/60"> assigned</span>
          {hasLimit && (
            <>
              <span className="text-bark/40"> of </span>
              <strong>{limit}h</strong>
            </>
          )}
        </span>
      </div>

      {hasLimit ? (
        <>
          <div className="mt-1 h-1.5 rounded bg-parchment overflow-hidden">
            <div
              className={`h-full rounded ${over ? "bg-terracotta" : "bg-sage"}`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className={`mt-0.5 text-[11px] ${over ? "text-terracotta font-semibold" : "text-bark"}`}>
            {over
              ? `${Math.abs(remaining!)}h over the limit`
              : `${remaining}h unassigned`}
          </p>
        </>
      ) : (
        <p className="mt-0.5 text-[11px] text-bark/50 italic">No overall limit set</p>
      )}
    </div>
  );
}

export default function AccountBudgetAllocation({
  vaId,
  weeklyLimit,
  monthlyLimit,
  refreshKey,
}: {
  vaId: string;
  weeklyLimit: number | null;
  monthlyLimit: number | null;
  /** Bump to re-read after a per-account budget is edited nearby. */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch(`/api/va-account-assignments?va_id=${vaId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.assignments ?? []);
    } catch {
      // Leave the last good numbers rather than blanking the block.
    } finally {
      setLoading(false);
    }
  }, [vaId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows, refreshKey]);

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-parchment/40" />;

  // Only a direct assignment can carry a budget, so inherited rows contribute 0.
  const budgeted = rows.filter((r) => !r.inherited);
  const weeklyAssigned = budgeted.reduce((s, r) => s + (Number(r.weekly_hours_budget) || 0), 0);
  const monthlyAssigned = budgeted.reduce((s, r) => s + (Number(r.monthly_hours_budget) || 0), 0);
  const withBudget = budgeted.filter(
    (r) => r.weekly_hours_budget != null || r.monthly_hours_budget != null
  );

  return (
    <div className="space-y-3 border-t border-parchment pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-walnut">
          Assigned to Accounts
        </span>
        <span className="text-[11px] text-bark">
          {withBudget.length} account{withBudget.length !== 1 ? "s" : ""} with a budget
        </span>
      </div>

      {withBudget.length === 0 ? (
        <p className="text-[11px] text-bark/50 italic">
          No account budgets set yet, so none of the overall limit is spoken for.
        </p>
      ) : (
        <>
          <Line label="Weekly" limit={weeklyLimit} assigned={weeklyAssigned} />
          <Line label="Monthly" limit={monthlyLimit} assigned={monthlyAssigned} />

          <div className="space-y-1 pt-1">
            {withBudget.map((r) => (
              <div key={r.accountName} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-espresso truncate">{r.accountName}</span>
                <span className="text-[11px] text-bark whitespace-nowrap">
                  {r.weekly_hours_budget != null ? `${Number(r.weekly_hours_budget)}h` : "—"}
                  <span className="text-bark/50"> wk</span>
                  <span className="text-bark/30"> · </span>
                  {r.monthly_hours_budget != null ? `${Number(r.monthly_hours_budget)}h` : "—"}
                  <span className="text-bark/50"> mo</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
