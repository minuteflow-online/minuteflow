"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";


/* ── Types ──────────────────────────────────────────────── */

interface AccountRow {
  id: number;
  name: string;
  active: boolean;
  billing_rate: number | null;
}

interface AccountMapping {
  account_id: number;
  client_id: number;
  clients: { id: number; name: string } | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  pay_rate: number;
  pay_rate_type: "hourly" | "daily" | "monthly";
  role: string;
  is_active: boolean;
}

interface LogRow {
  id: number;
  user_id: string;
  full_name: string;
  task_name: string;
  category: string;
  account: string | null;
  client_name: string | null;
  start_time: string;
  end_time: string | null;
  duration_ms: number;
  billable: boolean;
  form_fill_ms: number;
}

/* ── Constants ──────────────────────────────────────────── */

const UNPAID_CATEGORIES = ["Personal"];
const VIRTUAL_CONCIERGE = "Virtual Concierge";

// Categories where time is billed to Virtual Concierge (internal overhead)
const VC_BILLED_CATEGORIES = ["Break", "Sorting Tasks"];

/* ── Helpers ─────────────────────────────────────────────── */

function msToHours(ms: number): number {
  return ms / 3600000;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtHours(ms: number): string {
  const h = msToHours(ms);
  return h.toFixed(1) + "h";
}

function getMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/* ── Component ──────────────────────────────────────────── */

export default function FinancialSummaryTab() {
  const supabase = createClient();

  // Date range (default: current month)
  const monthRange = useMemo(() => getMonthRange(), []);
  const [startDate, setStartDate] = useState(toDateInputValue(monthRange.start));
  const [endDate, setEndDate] = useState(toDateInputValue(monthRange.end));

  // Filters
  const [filterVa, setFilterVa] = useState("");
  const [filterAccount, setFilterAccount] = useState("");

  // Data
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Fetch Data ──────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    setLoading(true);
    const rangeStart = `${startDate}T00:00:00.000Z`;
    const rangeEnd = `${endDate}T23:59:59.999Z`;

    const [accRes, profileRes, logRes] = await Promise.all([
      fetch("/api/accounts"),
      supabase
        .from("profiles")
        .select("id, full_name, pay_rate, pay_rate_type, role, is_active"),
      supabase
        .from("time_logs")
        .select(
          "id, user_id, full_name, task_name, category, account, client_name, start_time, end_time, duration_ms, billable, form_fill_ms"
        )
        .gte("start_time", rangeStart)
        .lte("start_time", rangeEnd)
        .not("end_time", "is", null)
        .gt("duration_ms", 0),
    ]);

    const accData = await accRes.json();
    setAccounts(accData.accounts ?? []);
    setMappings(accData.mappings ?? []);
    setProfiles((profileRes.data as ProfileRow[]) ?? []);
    setLogs((logRes.data as LogRow[]) ?? []);
    setLoading(false);
  }, [startDate, endDate, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Derived Data ────────────────────────────────────── */

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (filterVa) result = result.filter((l) => l.user_id === filterVa);
    if (filterAccount) result = result.filter((l) => l.account === filterAccount);
    return result;
  }, [logs, filterVa, filterAccount]);

  // Active accounts only
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active !== false),
    [accounts]
  );

  // VA profiles (only active va and manager, exclude admin and inactive)
  const vaProfiles = useMemo(
    () => profiles.filter((p) => (p.role === "va" || p.role === "manager") && p.is_active !== false),
    [profiles]
  );

  // Build account → billing rate map (active accounts only)
  const accountRateMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    activeAccounts.forEach((a) => {
      map[a.name] = a.billing_rate;
    });
    return map;
  }, [activeAccounts]);

  // Get clients linked to each account
  const accountClientMap = useMemo(() => {
    const map: Record<number, string[]> = {};
    mappings.forEach((m) => {
      if (m.clients) {
        if (!map[m.account_id]) map[m.account_id] = [];
        map[m.account_id].push(m.clients.name);
      }
    });
    return map;
  }, [mappings]);

  /* ── Revenue Calculation ─────────────────────────────── */
  // Revenue = billable hours per account × account billing rate
  // Break & Sorting Tasks get billed to Virtual Concierge

  const revenueData = useMemo(() => {
    const accountTotals: Record<
      string,
      { ms: number; clients: Set<string> }
    > = {};

    filteredLogs.forEach((log) => {
      if (log.category === "Personal") return; // unpaid, not billed

      // Determine billing account
      let billingAccount = log.account || "Unassigned";
      if (VC_BILLED_CATEGORIES.includes(log.category)) {
        billingAccount = VIRTUAL_CONCIERGE;
      }

      if (!accountTotals[billingAccount]) {
        accountTotals[billingAccount] = { ms: 0, clients: new Set() };
      }
      accountTotals[billingAccount].ms += log.duration_ms;
      if (log.client_name) accountTotals[billingAccount].clients.add(log.client_name);
    });

    const rows = Object.entries(accountTotals)
      .map(([account, data]) => {
        const rate = accountRateMap[account] ?? null;
        const hours = msToHours(data.ms);
        const amount = rate != null ? hours * rate : null;
        return {
          account,
          clients: Array.from(data.clients).join(", ") || "—",
          ms: data.ms,
          hours,
          rate,
          amount,
        };
      })
      .sort((a, b) => b.ms - a.ms);

    const totalMs = rows.reduce((s, r) => s + r.ms, 0);
    const totalAmount = rows.reduce(
      (s, r) => s + (r.amount ?? 0),
      0
    );
    const hasUnsetRates = rows.some((r) => r.rate == null);

    return { rows, totalMs, totalAmount, hasUnsetRates };
  }, [filteredLogs, accountRateMap]);

  /* ── VA Costs Calculation ────────────────────────────── */

  const vaCostData = useMemo(() => {
    // Group by user_id
    const userTotals: Record<
      string,
      { totalMs: number; paidMs: number; categoryMs: Record<string, number> }
    > = {};

    filteredLogs.forEach((log) => {
      if (!userTotals[log.user_id]) {
        userTotals[log.user_id] = { totalMs: 0, paidMs: 0, categoryMs: {} };
      }
      const ut = userTotals[log.user_id];
      ut.totalMs += log.duration_ms;

      if (!UNPAID_CATEGORIES.includes(log.category)) {
        ut.paidMs += log.duration_ms;
      }

      if (!ut.categoryMs[log.category]) ut.categoryMs[log.category] = 0;
      ut.categoryMs[log.category] += log.duration_ms;
    });

    const profileMap: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (profileMap[p.id] = p));

    const activeVaIds = new Set(vaProfiles.map((p) => p.id));

    const rows = Object.entries(userTotals)
      .map(([userId, data]) => {
        const profile = profileMap[userId];
        if (!profile || !activeVaIds.has(userId)) return null;

        // Calculate hourly rate
        let hourlyRate = profile.pay_rate;
        if (profile.pay_rate_type === "daily") hourlyRate = profile.pay_rate / 8;
        if (profile.pay_rate_type === "monthly") hourlyRate = profile.pay_rate / 160;

        const paidHours = msToHours(data.paidMs);
        const grossPay = paidHours * hourlyRate;

        // Build category breakdown string
        const breakdown = Object.entries(data.categoryMs)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, ms]) => `${cat}: ${fmtHours(ms)}`)
          .join(", ");

        return {
          userId,
          name: profile.full_name,
          totalMs: data.totalMs,
          paidMs: data.paidMs,
          hourlyRate,
          grossPay,
          breakdown,
        };
      })
      .filter(Boolean) as {
      userId: string;
      name: string;
      totalMs: number;
      paidMs: number;
      hourlyRate: number;
      grossPay: number;
      breakdown: string;
    }[];

    rows.sort((a, b) => b.grossPay - a.grossPay);

    const totalCost = rows.reduce((s, r) => s + r.grossPay, 0);
    const totalPaidMs = rows.reduce((s, r) => s + r.paidMs, 0);

    return { rows, totalCost, totalPaidMs };
  }, [filteredLogs, profiles, vaProfiles]);

  /* ── Category Breakdown ──────────────────────────────── */

  const categoryData = useMemo(() => {
    const catMs: Record<string, number> = {};
    filteredLogs.forEach((log) => {
      if (!catMs[log.category]) catMs[log.category] = 0;
      catMs[log.category] += log.duration_ms;
    });

    const totalMs = Object.values(catMs).reduce((s, v) => s + v, 0);

    const rows = Object.entries(catMs)
      .map(([category, ms]) => ({
        category,
        ms,
        pct: totalMs > 0 ? (ms / totalMs) * 100 : 0,
        paid: !UNPAID_CATEGORIES.includes(category),
      }))
      .sort((a, b) => b.ms - a.ms);

    return { rows, totalMs };
  }, [filteredLogs]);

  /* ── Profit Summary ──────────────────────────────────── */

  const profitData = useMemo(() => {
    const revenue = revenueData.totalAmount;
    const cost = vaCostData.totalCost;
    const net = revenue - cost;
    const margin = revenue > 0 ? (net / revenue) * 100 : 0;
    return { revenue, cost, net, margin };
  }, [revenueData, vaCostData]);

  /* ── Unique accounts for filter (active only) ──────────── */
  const activeAccountNames = useMemo(() => {
    const activeSet = new Set(activeAccounts.map((a) => a.name));
    return Array.from(activeSet).sort();
  }, [activeAccounts]);

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* ── Filters ──────────────────────────────────────── */}
      <div className="rounded-xl border border-sand bg-white p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-sand px-3 py-1.5 text-[13px] text-espresso outline-none focus:border-terracotta"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-sand px-3 py-1.5 text-[13px] text-espresso outline-none focus:border-terracotta"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">
              VA
            </label>
            <select
              value={filterVa}
              onChange={(e) => setFilterVa(e.target.value)}
              className="rounded-lg border border-sand px-3 py-1.5 text-[13px] text-espresso outline-none focus:border-terracotta"
            >
              <option value="">All VAs</option>
              {vaProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-bark">
              Account
            </label>
            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className="rounded-lg border border-sand px-3 py-1.5 text-[13px] text-espresso outline-none focus:border-terracotta"
            >
              <option value="">All Accounts</option>
              {activeAccountNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              const m = getMonthRange();
              setStartDate(toDateInputValue(m.start));
              setEndDate(toDateInputValue(m.end));
              setFilterVa("");
              setFilterAccount("");
            }}
            className="rounded-lg border border-sand px-3 py-1.5 text-[11px] font-medium text-bark hover:border-terracotta hover:text-terracotta transition-colors cursor-pointer"
          >
            Reset
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl border border-sand bg-white" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Profit Summary Cards ───────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard
              label="Revenue"
              value={fmtMoney(profitData.revenue)}
              sub={revenueData.hasUnsetRates ? "Some rates not set" : undefined}
              color="text-sage"
            />
            <SummaryCard
              label="VA Costs"
              value={fmtMoney(profitData.cost)}
              sub={fmtHours(vaCostData.totalPaidMs) + " paid hours"}
              color="text-terracotta"
            />
            <SummaryCard
              label="Net Margin"
              value={fmtMoney(profitData.net)}
              sub={profitData.margin.toFixed(1) + "%"}
              color={profitData.net >= 0 ? "text-sage" : "text-red-500"}
            />
            <SummaryCard
              label="Total Hours"
              value={fmtHours(categoryData.totalMs)}
              sub={filteredLogs.length + " entries"}
              color="text-slate-blue"
            />
          </div>

          {/* ── Revenue (Client Collectibles) ──────────────── */}
          <Section title="Revenue — Client Collectibles">
            {revenueData.rows.length === 0 ? (
              <EmptyState text="No time logs found for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3">Account</th>
                      <th className="px-3 py-3">Clients</th>
                      <th className="px-3 py-3 text-right">Hours</th>
                      <th className="px-3 py-3 text-right">Rate</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {revenueData.rows.map((row) => (
                      <tr key={row.account} className="hover:bg-parchment/20 transition-colors">
                        <td className="px-4 py-3 font-semibold text-espresso">{row.account}</td>
                        <td className="px-3 py-3 text-bark">{row.clients}</td>
                        <td className="px-3 py-3 text-right font-medium text-espresso">
                          {fmtHours(row.ms)}
                        </td>
                        <td className="px-3 py-3 text-right text-bark">
                          {row.rate != null ? `${fmtMoney(row.rate)}/hr` : (
                            <span className="italic text-bark/50">Not set</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {row.amount != null ? (
                            <span className="text-sage">{fmtMoney(row.amount)}</span>
                          ) : (
                            <span className="italic text-bark/50">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3" colSpan={2}>
                        Total Revenue
                      </td>
                      <td className="px-3 py-3 text-right">{fmtHours(revenueData.totalMs)}</td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right text-sage">
                        {fmtMoney(revenueData.totalAmount)}
                        {revenueData.hasUnsetRates && (
                          <span className="ml-1 text-[10px] font-normal italic text-bark/50">
                            (partial)
                          </span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* ── VA Costs ───────────────────────────────────── */}
          <Section title="VA Costs — What You Pay">
            {vaCostData.rows.length === 0 ? (
              <EmptyState text="No VA activity found for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3">VA</th>
                      <th className="px-3 py-3 text-right">Paid Hours</th>
                      <th className="px-3 py-3 text-right">Rate</th>
                      <th className="px-3 py-3 text-right">Gross Pay</th>
                      <th className="px-3 py-3">Breakdown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {vaCostData.rows.map((row) => (
                      <tr key={row.userId} className="hover:bg-parchment/20 transition-colors">
                        <td className="px-4 py-3 font-semibold text-espresso">{row.name}</td>
                        <td className="px-3 py-3 text-right font-medium text-espresso">
                          {fmtHours(row.paidMs)}
                        </td>
                        <td className="px-3 py-3 text-right text-bark">
                          {fmtMoney(row.hourlyRate)}/hr
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-terracotta">
                          {fmtMoney(row.grossPay)}
                        </td>
                        <td className="px-3 py-3 text-[11px] text-bark max-w-xs truncate">
                          {row.breakdown}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3">Total VA Cost</td>
                      <td className="px-3 py-3 text-right">
                        {fmtHours(vaCostData.totalPaidMs)}
                      </td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right text-terracotta">
                        {fmtMoney(vaCostData.totalCost)}
                      </td>
                      <td className="px-3 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* ── Category Breakdown ─────────────────────────── */}
          <Section title="Category Breakdown — Where Time Goes">
            {categoryData.rows.length === 0 ? (
              <EmptyState text="No time logs found for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3">Category</th>
                      <th className="px-3 py-3 text-right">Hours</th>
                      <th className="px-3 py-3 text-right">% of Total</th>
                      <th className="px-3 py-3 text-center">Paid?</th>
                      <th className="px-3 py-3">Bar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {categoryData.rows.map((row) => (
                      <tr key={row.category} className="hover:bg-parchment/20 transition-colors">
                        <td className="px-4 py-3 font-semibold text-espresso">{row.category}</td>
                        <td className="px-3 py-3 text-right font-medium text-espresso">
                          {fmtHours(row.ms)}
                        </td>
                        <td className="px-3 py-3 text-right text-bark">
                          {row.pct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-3 text-center">
                          {row.paid ? (
                            <span className="inline-block rounded-full bg-sage-soft px-2 py-0.5 text-[10px] font-semibold text-sage">
                              Yes
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-parchment px-2 py-0.5 text-[10px] font-semibold text-stone">
                              No
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="h-2 w-full rounded-full bg-parchment">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                row.paid ? "bg-sage" : "bg-stone"
                              }`}
                              style={{ width: `${Math.min(row.pct, 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-3 py-3 text-right">
                        {fmtHours(categoryData.totalMs)}
                      </td>
                      <td className="px-3 py-3 text-right">100%</td>
                      <td className="px-3 py-3" colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-sand bg-white p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-bark">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-bark/70">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      <div className="border-b border-parchment bg-parchment/20 px-5 py-3">
        <h3 className="text-sm font-bold text-espresso">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-[13px] text-bark/50">
      {text}
    </div>
  );
}
