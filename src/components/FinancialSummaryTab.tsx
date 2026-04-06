"use client";

import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
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
  billing_type: "hourly" | "fixed";
  task_rate: number | null;
}

interface VaFixedAssignment {
  va_id: string;
  task_name: string;
  account: string | null;
  project_name: string | null;
  rate: number;
  task_library_id: number;
  status: "not_started" | "submitted" | "revision_needed" | "approved";
}

interface VaPaymentRow {
  id: number;
  va_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  confirmation_number: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
}

interface ClientPaymentRow {
  id: number;
  account: string;
  client_name: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  confirmation_number: string | null;
  notes: string | null;
}

interface ExpenseRow {
  id: number;
  account: string | null;
  description: string;
  amount: number;
  expense_date: string;
  category: string;
  is_reimbursable: boolean;
  reimbursed: boolean;
  notes: string | null;
}

/* ── Constants ──────────────────────────────────────────── */

const UNPAID_CATEGORIES = ["Personal"];
const VIRTUAL_CONCIERGE = "Virtual Concierge";

// Categories where time is billed to Virtual Concierge (internal overhead)
const VC_BILLED_CATEGORIES = ["Break", "Planning", "Sorting Tasks", "Sorting"];

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "check", label: "Check" },
  { value: "zelle", label: "Zelle" },
  { value: "cash", label: "Cash" },
  { value: "paypal", label: "PayPal" },
  { value: "venmo", label: "Venmo" },
  { value: "other", label: "Other" },
];

const EXPENSE_CATEGORIES = [
  { value: "tools", label: "Tools" },
  { value: "subscription", label: "Subscription" },
  { value: "software", label: "Software" },
  { value: "supplies", label: "Supplies" },
  { value: "travel", label: "Travel" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "other", label: "Other" },
];

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

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
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
  const [expenseTypeFilter, setExpenseTypeFilter] = useState<"all" | "business" | "reimbursable">("all");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [expenseSortField, setExpenseSortField] = useState<"date" | "amount" | "category">("date");
  const [expenseSortAsc, setExpenseSortAsc] = useState(false);

  // Data
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [vaPayments, setVaPayments] = useState<VaPaymentRow[]>([]);
  const [clientPayments, setClientPayments] = useState<ClientPaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [vaFixedAssignments, setVaFixedAssignments] = useState<VaFixedAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  // Expand/collapse state
  const [expandedVas, setExpandedVas] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // Modal state
  const [showVaPaymentModal, setShowVaPaymentModal] = useState<string | null>(null); // va user_id
  const [showClientPaymentModal, setShowClientPaymentModal] = useState<string | null>(null); // account name
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  /* ── Toggle helpers ────────────────────────────────────── */

  const toggleVa = (userId: string) => {
    setExpandedVas((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAccount = (account: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });
  };

  /* ── Fetch Data ──────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    setLoading(true);
    const rangeStart = `${startDate}T00:00:00.000Z`;
    const rangeEnd = `${endDate}T23:59:59.999Z`;

    const [accRes, profileRes, logRes, vaPayRes, clientPayRes, expRes, vaFixedRes] = await Promise.all([
      fetch("/api/accounts"),
      supabase
        .from("profiles")
        .select("id, full_name, pay_rate, pay_rate_type, role, is_active"),
      supabase
        .from("time_logs")
        .select(
          "id, user_id, full_name, task_name, category, account, client_name, start_time, end_time, duration_ms, billable, form_fill_ms, billing_type, task_rate"
        )
        .gte("start_time", rangeStart)
        .lte("start_time", rangeEnd)
        .not("end_time", "is", null)
        .gt("duration_ms", 0),
      supabase
        .from("va_payments")
        .select("id, va_id, amount, payment_date, payment_method, confirmation_number, period_start, period_end, notes")
        .gte("payment_date", startDate)
        .lte("payment_date", endDate)
        .order("payment_date", { ascending: false }),
      supabase
        .from("financial_payments")
        .select("id, account, client_name, amount, payment_date, payment_method, confirmation_number, notes")
        .gte("payment_date", startDate)
        .lte("payment_date", endDate)
        .order("payment_date", { ascending: false }),
      supabase
        .from("financial_expenses")
        .select("id, account, description, amount, expense_date, category, is_reimbursable, reimbursed, notes")
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .order("expense_date", { ascending: false }),
      // Fetch VA fixed-rate task assignments (for pending/earned fixed task display)
      supabase
        .from("va_task_assignments")
        .select(
          "va_id, billing_type, rate, status, project_task_assignments(task_library_id, project_tag_id, task_library(id, task_name), project_tags(id, account, project_name))"
        )
        .eq("billing_type", "fixed")
        .gt("rate", 0)
        .eq("assignment_type", "include"),
    ]);

    const accData = await accRes.json();
    setAccounts(accData.accounts ?? []);
    setMappings(accData.mappings ?? []);
    setProfiles((profileRes.data as ProfileRow[]) ?? []);
    setLogs((logRes.data as LogRow[]) ?? []);
    setVaPayments((vaPayRes.data as VaPaymentRow[]) ?? []);
    setClientPayments((clientPayRes.data as ClientPaymentRow[]) ?? []);
    setExpenses((expRes.data as ExpenseRow[]) ?? []);

    // Parse VA fixed assignments into flat structure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFixed = (vaFixedRes.data ?? []) as any[];
    const parsedFixed: VaFixedAssignment[] = rawFixed.map((row) => {
      const pta = row.project_task_assignments;
      const lib = pta?.task_library;
      const proj = pta?.project_tags;
      return {
        va_id: row.va_id,
        task_name: lib?.task_name ?? "Unknown Task",
        account: proj?.account ?? null,
        project_name: proj?.project_name ?? null,
        rate: Number(row.rate),
        task_library_id: lib?.id ?? 0,
        status: row.status ?? "not_started",
      };
    });
    setVaFixedAssignments(parsedFixed);

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

  // VA profiles (all active team members, regardless of role)
  const vaProfiles = useMemo(
    () => profiles.filter((p) => p.is_active !== false),
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

  // VA payments grouped by va_id
  const vaPaymentsByUser = useMemo(() => {
    const map: Record<string, VaPaymentRow[]> = {};
    vaPayments.forEach((p) => {
      if (!map[p.va_id]) map[p.va_id] = [];
      map[p.va_id].push(p);
    });
    return map;
  }, [vaPayments]);

  // Client payments grouped by account
  const clientPaymentsByAccount = useMemo(() => {
    const map: Record<string, ClientPaymentRow[]> = {};
    clientPayments.forEach((p) => {
      if (!map[p.account]) map[p.account] = [];
      map[p.account].push(p);
    });
    return map;
  }, [clientPayments]);

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
        const payments = clientPaymentsByAccount[account] ?? [];
        const collected = payments.reduce((s, p) => s + Number(p.amount), 0);
        return {
          account,
          clients: Array.from(data.clients).join(", ") || "—",
          ms: data.ms,
          hours,
          rate,
          amount,
          collected,
          balance: amount != null ? amount - collected : null,
          payments,
        };
      })
      .sort((a, b) => b.ms - a.ms);

    const totalMs = rows.reduce((s, r) => s + r.ms, 0);
    const totalAmount = rows.reduce(
      (s, r) => s + (r.amount ?? 0),
      0
    );
    const totalCollected = rows.reduce((s, r) => s + r.collected, 0);
    const hasUnsetRates = rows.some((r) => r.rate == null);

    return { rows, totalMs, totalAmount, totalCollected, hasUnsetRates };
  }, [filteredLogs, accountRateMap, clientPaymentsByAccount]);

  /* ── VA Costs Calculation (Enhanced with day breakdown + fixed tasks from assignments) ── */

  const vaCostData = useMemo(() => {
    // Group time logs by user_id
    const userTotals: Record<
      string,
      {
        totalMs: number;
        paidMs: number;
        categoryMs: Record<string, number>;
        dayBreakdown: Record<string, { ms: number; paidMs: number }>;
        loggedFixedTasks: Set<string>; // task names logged as fixed (for earned check)
      }
    > = {};

    filteredLogs.forEach((log) => {
      if (!userTotals[log.user_id]) {
        userTotals[log.user_id] = {
          totalMs: 0,
          paidMs: 0,
          categoryMs: {},
          dayBreakdown: {},
          loggedFixedTasks: new Set(),
        };
      }
      const ut = userTotals[log.user_id];
      ut.totalMs += log.duration_ms;

      if (!UNPAID_CATEGORIES.includes(log.category)) {
        ut.paidMs += log.duration_ms;
      }

      if (!ut.categoryMs[log.category]) ut.categoryMs[log.category] = 0;
      ut.categoryMs[log.category] += log.duration_ms;

      // Day breakdown
      const day = log.start_time.slice(0, 10);
      if (!ut.dayBreakdown[day]) ut.dayBreakdown[day] = { ms: 0, paidMs: 0 };
      ut.dayBreakdown[day].ms += log.duration_ms;
      if (!UNPAID_CATEGORIES.includes(log.category)) {
        ut.dayBreakdown[day].paidMs += log.duration_ms;
      }

      // Track which fixed tasks were actually logged (for pending/earned status)
      if (log.billing_type === "fixed") {
        ut.loggedFixedTasks.add(log.task_name);
      }
    });

    // Build fixed tasks from VA assignments (not time_logs)
    // Group assignments by va_id
    const assignmentsByVa: Record<
      string,
      { task_name: string; account: string | null; project_name: string | null; rate: number; earned: boolean }[]
    > = {};

    vaFixedAssignments.forEach((a) => {
      if (!assignmentsByVa[a.va_id]) assignmentsByVa[a.va_id] = [];
      // Earned = admin approved the submission; pending = anything else
      const earned = a.status === "approved";
      assignmentsByVa[a.va_id].push({
        task_name: a.task_name,
        account: a.account,
        project_name: a.project_name,
        rate: a.rate,
        earned,
      });
    });

    const profileMap: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (profileMap[p.id] = p));

    const activeVaIds = new Set(vaProfiles.map((p) => p.id));

    // Collect all VA IDs that have either time logs OR fixed assignments
    const allVaIds = new Set([
      ...Object.keys(userTotals),
      ...Object.keys(assignmentsByVa),
    ]);

    const rows = Array.from(allVaIds)
      .map((userId) => {
        const profile = profileMap[userId];
        if (!profile || !activeVaIds.has(userId)) return null;

        const data = userTotals[userId] ?? {
          totalMs: 0,
          paidMs: 0,
          categoryMs: {},
          dayBreakdown: {},
          loggedFixedTasks: new Set<string>(),
        };

        // Calculate hourly rate
        let hourlyRate = profile.pay_rate;
        if (profile.pay_rate_type === "daily") hourlyRate = profile.pay_rate / 8;
        if (profile.pay_rate_type === "monthly") hourlyRate = profile.pay_rate / 160;

        const paidHours = msToHours(data.paidMs);
        const hourlyPay = paidHours * hourlyRate;

        // Fixed tasks come from assignments, not time_logs
        const fixedTasks = assignmentsByVa[userId] ?? [];
        const fixedPay = fixedTasks.reduce((s, t) => s + t.rate, 0);
        const earnedFixedPay = fixedTasks.filter((t) => t.earned).reduce((s, t) => s + t.rate, 0);
        const grossPay = hourlyPay + fixedPay;

        // Payments made to this VA
        const payments = vaPaymentsByUser[userId] ?? [];
        const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

        // Build category breakdown string
        const breakdown = Object.entries(data.categoryMs)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, ms]) => `${cat}: ${fmtHours(ms)}`)
          .join(", ");

        // Day breakdown sorted by date
        const days = Object.entries(data.dayBreakdown)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, d]) => ({
            date,
            ms: d.ms,
            paidMs: d.paidMs,
            amount: msToHours(d.paidMs) * hourlyRate,
          }));

        return {
          userId,
          name: profile.full_name,
          totalMs: data.totalMs,
          paidMs: data.paidMs,
          hourlyRate,
          hourlyPay,
          fixedPay,
          earnedFixedPay,
          grossPay,
          totalPaid,
          balance: grossPay - totalPaid,
          breakdown,
          days,
          fixedTasks,
          payments,
        };
      })
      .filter(Boolean) as {
      userId: string;
      name: string;
      totalMs: number;
      paidMs: number;
      hourlyRate: number;
      hourlyPay: number;
      fixedPay: number;
      earnedFixedPay: number;
      grossPay: number;
      totalPaid: number;
      balance: number;
      breakdown: string;
      days: { date: string; ms: number; paidMs: number; amount: number }[];
      fixedTasks: { task_name: string; account: string | null; project_name: string | null; rate: number; earned: boolean }[];
      payments: VaPaymentRow[];
    }[];

    rows.sort((a, b) => b.grossPay - a.grossPay);

    const totalCost = rows.reduce((s, r) => s + r.grossPay, 0);
    const totalPaidMs = rows.reduce((s, r) => s + r.paidMs, 0);
    const totalVaPaid = rows.reduce((s, r) => s + r.totalPaid, 0);

    return { rows, totalCost, totalPaidMs, totalVaPaid };
  }, [filteredLogs, profiles, vaProfiles, vaPaymentsByUser, vaFixedAssignments]);

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

  /* ── Expenses Calculation ───────────────────────────── */

  const expenseData = useMemo(() => {
    // Totals from ALL expenses (unfiltered) for summary cards
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const reimbursableTotal = expenses
      .filter((e) => e.is_reimbursable)
      .reduce((s, e) => s + Number(e.amount), 0);
    const reimbursedTotal = expenses
      .filter((e) => e.reimbursed)
      .reduce((s, e) => s + Number(e.amount), 0);
    const businessTotal = expenses
      .filter((e) => !e.is_reimbursable)
      .reduce((s, e) => s + Number(e.amount), 0);

    // Apply filters
    let filtered = [...expenses];
    if (expenseTypeFilter === "business") filtered = filtered.filter((e) => !e.is_reimbursable);
    if (expenseTypeFilter === "reimbursable") filtered = filtered.filter((e) => e.is_reimbursable);
    if (expenseCategoryFilter) filtered = filtered.filter((e) => e.category === expenseCategoryFilter);

    // Apply sorting
    filtered.sort((a, b) => {
      let cmp = 0;
      if (expenseSortField === "date") cmp = a.expense_date.localeCompare(b.expense_date);
      else if (expenseSortField === "amount") cmp = Number(a.amount) - Number(b.amount);
      else if (expenseSortField === "category") cmp = a.category.localeCompare(b.category);
      return expenseSortAsc ? cmp : -cmp;
    });

    // Unique categories in current data
    const categories = Array.from(new Set(expenses.map((e) => e.category))).sort();

    return { rows: filtered, totalExpenses, reimbursableTotal, reimbursedTotal, businessTotal, categories };
  }, [expenses, expenseTypeFilter, expenseCategoryFilter, expenseSortField, expenseSortAsc]);

  /* ── Profit Summary ──────────────────────────────────── */

  const profitData = useMemo(() => {
    const revenue = revenueData.totalAmount;
    const cost = vaCostData.totalCost;
    const expenseTotal = expenseData.totalExpenses;
    const net = revenue - cost - expenseTotal;
    const margin = revenue > 0 ? (net / revenue) * 100 : 0;
    const collected = revenueData.totalCollected;
    const receivable = revenue - collected; // what clients still owe you
    const vaPaid = vaCostData.totalVaPaid;
    const vaPayable = cost - vaPaid; // what you still owe VAs
    return { revenue, cost, net, margin, expenseTotal, collected, receivable, vaPaid, vaPayable };
  }, [revenueData, vaCostData, expenseData]);

  /* ── Unique accounts for filter (active only) ──────────── */
  const activeAccountNames = useMemo(() => {
    const activeSet = new Set(activeAccounts.map((a) => a.name));
    return Array.from(activeSet).sort();
  }, [activeAccounts]);

  /* ── Save handlers ──────────────────────────────────── */

  const saveVaPayment = async (vaId: string, form: {
    amount: string; payment_date: string; payment_method: string;
    confirmation_number: string; notes: string;
  }) => {
    const { error } = await supabase.from("va_payments").insert({
      va_id: vaId,
      amount: parseFloat(form.amount),
      payment_date: form.payment_date,
      payment_method: form.payment_method,
      confirmation_number: form.confirmation_number || null,
      period_start: startDate,
      period_end: endDate,
      notes: form.notes || null,
    });
    if (error) { alert("Error saving payment: " + error.message); return; }
    setShowVaPaymentModal(null);
    fetchData();
  };

  const saveClientPayment = async (account: string, form: {
    amount: string; payment_date: string; payment_method: string;
    confirmation_number: string; client_name: string; notes: string;
  }) => {
    const { error } = await supabase.from("financial_payments").insert({
      account,
      client_name: form.client_name || null,
      amount: parseFloat(form.amount),
      payment_date: form.payment_date,
      payment_method: form.payment_method,
      confirmation_number: form.confirmation_number || null,
      notes: form.notes || null,
    });
    if (error) { alert("Error saving payment: " + error.message); return; }
    setShowClientPaymentModal(null);
    fetchData();
  };

  const saveExpense = async (form: {
    description: string; amount: string; expense_date: string;
    category: string; account: string; is_reimbursable: boolean; notes: string;
  }) => {
    const { error } = await supabase.from("financial_expenses").insert({
      account: form.account || null,
      description: form.description,
      amount: parseFloat(form.amount),
      expense_date: form.expense_date,
      category: form.category,
      is_reimbursable: form.is_reimbursable,
      notes: form.notes || null,
    });
    if (error) { alert("Error saving expense: " + error.message); return; }
    setShowExpenseModal(false);
    fetchData();
  };

  const deleteVaPayment = async (paymentId: number) => {
    if (!confirm("Delete this payment record?")) return;
    await supabase.from("va_payments").delete().eq("id", paymentId);
    fetchData();
  };

  const deleteClientPayment = async (paymentId: number) => {
    if (!confirm("Delete this payment record?")) return;
    await supabase.from("financial_payments").delete().eq("id", paymentId);
    fetchData();
  };

  const deleteExpense = async (expenseId: number) => {
    if (!confirm("Delete this expense?")) return;
    await supabase.from("financial_expenses").delete().eq("id", expenseId);
    fetchData();
  };

  const toggleReimbursed = async (expenseId: number, current: boolean) => {
    await supabase.from("financial_expenses").update({ reimbursed: !current }).eq("id", expenseId);
    fetchData();
  };

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
          {/* ── Summary Cards — Organized by Paid/Collected vs Payable/Receivable ── */}
          <div className="space-y-3">
            {/* Row 1: What's been paid & collected (done) */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-bark/60 mb-2 px-1">Paid & Collected</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard
                  label="Collected from Clients"
                  value={fmtMoney(profitData.collected)}
                  sub={`of ${fmtMoney(profitData.revenue)} billed`}
                  color="text-emerald-600"
                />
                <SummaryCard
                  label="Total VA Payments"
                  value={fmtMoney(profitData.vaPaid)}
                  sub={`of ${fmtMoney(profitData.cost)} earned`}
                  color="text-emerald-600"
                />
                <SummaryCard
                  label="Expenses Paid"
                  value={fmtMoney(profitData.expenseTotal)}
                  sub={expenses.length + " entries"}
                  color="text-amber-600"
                />
                <SummaryCard
                  label="Net Margin"
                  value={fmtMoney(profitData.net)}
                  sub={profitData.margin.toFixed(1) + "% margin"}
                  color={profitData.net >= 0 ? "text-sage" : "text-red-500"}
                />
              </div>
            </div>
            {/* Row 2: What's still owed (outstanding) */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-bark/60 mb-2 px-1">Payable & Receivable</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard
                  label="Receivable from Clients"
                  value={fmtMoney(profitData.receivable)}
                  sub={profitData.receivable > 0 ? "clients still owe" : "all collected"}
                  color={profitData.receivable > 0 ? "text-amber-600" : "text-sage"}
                />
                <SummaryCard
                  label="Payable to VAs"
                  value={fmtMoney(profitData.vaPayable)}
                  sub={profitData.vaPayable > 0.01 ? "still owed to VAs" : "all paid up"}
                  color={profitData.vaPayable > 0.01 ? "text-amber-600" : "text-sage"}
                />
                <SummaryCard
                  label="Revenue"
                  value={fmtMoney(profitData.revenue)}
                  sub={revenueData.hasUnsetRates ? "Some rates not set" : fmtHours(revenueData.totalMs) + " billed"}
                  color="text-sage"
                />
                <SummaryCard
                  label="Total Hours"
                  value={fmtHours(categoryData.totalMs)}
                  sub={filteredLogs.length + " entries"}
                  color="text-slate-blue"
                />
              </div>
            </div>
          </div>

          {/* ── Revenue (Client Collectibles) — Expandable ──── */}
          <Section
            title="Revenue — Client Collectibles"
            action={
              <button
                onClick={() => setShowClientPaymentModal("")}
                className="rounded-lg bg-sage px-3 py-1 text-[11px] font-semibold text-white hover:bg-sage/80 transition-colors cursor-pointer"
              >
                + Add Payment
              </button>
            }
          >
            {revenueData.rows.length === 0 ? (
              <EmptyState text="No time logs found for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3 w-5"></th>
                      <th className="px-2 py-3">Account</th>
                      <th className="px-3 py-3">Clients</th>
                      <th className="px-3 py-3 text-right">Hours</th>
                      <th className="px-3 py-3 text-right">Rate</th>
                      <th className="px-3 py-3 text-right">Owed</th>
                      <th className="px-3 py-3 text-right">Collected</th>
                      <th className="px-3 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {revenueData.rows.map((row) => (
                      <Fragment key={row.account}>
                        <tr
                          onClick={() => toggleAccount(row.account)}
                          className="hover:bg-parchment/20 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 text-bark">
                            <span className={`inline-block transition-transform ${expandedAccounts.has(row.account) ? "rotate-90" : ""}`}>
                              ▶
                            </span>
                          </td>
                          <td className="px-2 py-3 font-semibold text-espresso">{row.account}</td>
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
                          <td className="px-3 py-3 text-right font-medium text-emerald-600">
                            {fmtMoney(row.collected)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {row.balance != null ? (
                              <span className={row.balance > 0 ? "text-amber-600" : "text-sage"}>
                                {fmtMoney(row.balance)}
                              </span>
                            ) : (
                              <span className="italic text-bark/50">—</span>
                            )}
                          </td>
                        </tr>
                        {expandedAccounts.has(row.account) && (
                          <tr>
                            <td colSpan={8} className="bg-parchment/10 px-6 py-4">
                              <div className="space-y-3">
                                {/* Payment History */}
                                <div className="flex items-center justify-between">
                                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-bark">
                                    Payment History
                                  </h4>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setShowClientPaymentModal(row.account); }}
                                    className="rounded bg-sage px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-sage/80 cursor-pointer"
                                  >
                                    + Add Payment
                                  </button>
                                </div>
                                {row.payments.length === 0 ? (
                                  <p className="text-[11px] text-bark/50 italic">No payments recorded.</p>
                                ) : (
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-[9px] font-semibold uppercase tracking-wider text-bark/60">
                                        <th className="py-1 text-left">Date</th>
                                        <th className="py-1 text-left">Method</th>
                                        <th className="py-1 text-left">Confirmation #</th>
                                        <th className="py-1 text-right">Amount</th>
                                        <th className="py-1 text-left">Notes</th>
                                        <th className="py-1 w-8"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.payments.map((p) => (
                                        <tr key={p.id} className="border-t border-parchment/50">
                                          <td className="py-1.5 text-espresso">{fmtDateFull(p.payment_date)}</td>
                                          <td className="py-1.5 text-bark">{methodLabel(p.payment_method)}</td>
                                          <td className="py-1.5 text-bark">{p.confirmation_number || "—"}</td>
                                          <td className="py-1.5 text-right font-semibold text-emerald-600">{fmtMoney(Number(p.amount))}</td>
                                          <td className="py-1.5 text-bark/70 max-w-[150px] truncate">{p.notes || "—"}</td>
                                          <td className="py-1.5">
                                            <button
                                              onClick={(e) => { e.stopPropagation(); deleteClientPayment(p.id); }}
                                              className="text-red-400 hover:text-red-600 text-[10px] cursor-pointer"
                                              title="Delete"
                                            >
                                              ✕
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3" />
                      <td className="px-2 py-3" colSpan={2}>
                        Total Revenue
                      </td>
                      <td className="px-3 py-3 text-right">{fmtHours(revenueData.totalMs)}</td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right text-sage">
                        {fmtMoney(revenueData.totalAmount)}
                      </td>
                      <td className="px-3 py-3 text-right text-emerald-600">
                        {fmtMoney(revenueData.totalCollected)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {fmtMoney(revenueData.totalAmount - revenueData.totalCollected)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* ── VA Costs — Expandable ─────────────────────── */}
          <Section title="VA Costs — What You Pay">
            {vaCostData.rows.length === 0 ? (
              <EmptyState text="No VA activity found for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3 w-5"></th>
                      <th className="px-2 py-3">VA</th>
                      <th className="px-3 py-3 text-right">Paid Hours</th>
                      <th className="px-3 py-3 text-right">Rate</th>
                      <th className="px-3 py-3 text-right">Fixed Tasks</th>
                      <th className="px-3 py-3 text-right">Total Earned</th>
                      <th className="px-3 py-3 text-right">Paid</th>
                      <th className="px-3 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {vaCostData.rows.map((row) => (
                      <Fragment key={row.userId}>
                        <tr
                          onClick={() => toggleVa(row.userId)}
                          className="hover:bg-parchment/20 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 text-bark">
                            <span className={`inline-block transition-transform ${expandedVas.has(row.userId) ? "rotate-90" : ""}`}>
                              ▶
                            </span>
                          </td>
                          <td className="px-2 py-3 font-semibold text-espresso">{row.name}</td>
                          <td className="px-3 py-3 text-right font-medium text-espresso">
                            {fmtHours(row.paidMs)}
                          </td>
                          <td className="px-3 py-3 text-right text-bark">
                            {fmtMoney(row.hourlyRate)}/hr
                          </td>
                          <td className="px-3 py-3 text-right text-bark">
                            {row.fixedPay > 0 ? fmtMoney(row.fixedPay) : "—"}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-terracotta">
                            {fmtMoney(row.grossPay)}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-emerald-600">
                            {fmtMoney(row.totalPaid)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            <span className={row.balance > 0.01 ? "text-amber-600" : "text-sage"}>
                              {fmtMoney(row.balance)}
                            </span>
                          </td>
                        </tr>
                        {expandedVas.has(row.userId) && (
                          <tr>
                            <td colSpan={8} className="bg-parchment/10 px-6 py-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Day-by-day breakdown */}
                                <div>
                                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-bark mb-2">
                                    Daily Breakdown
                                  </h4>
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-[9px] font-semibold uppercase tracking-wider text-bark/60">
                                        <th className="py-1 text-left">Date</th>
                                        <th className="py-1 text-right">Total</th>
                                        <th className="py-1 text-right">Paid Hours</th>
                                        <th className="py-1 text-right">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.days.map((d) => (
                                        <tr key={d.date} className="border-t border-parchment/50">
                                          <td className="py-1 text-espresso">{fmtDate(d.date)}</td>
                                          <td className="py-1 text-right text-bark">{fmtHours(d.ms)}</td>
                                          <td className="py-1 text-right text-bark">{fmtHours(d.paidMs)}</td>
                                          <td className="py-1 text-right font-medium text-espresso">{fmtMoney(d.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>

                                  {/* Fixed tasks (from VA assignments — shows pending/earned) */}
                                  {row.fixedTasks.length > 0 && (
                                    <div className="mt-4">
                                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-bark mb-2">
                                        Fixed Tasks
                                      </h4>
                                      <table className="w-full text-[11px]">
                                        <thead>
                                          <tr className="text-[9px] font-semibold uppercase tracking-wider text-bark/60">
                                            <th className="py-1 text-left">Task</th>
                                            <th className="py-1 text-left">Account</th>
                                            <th className="py-1 text-center">Status</th>
                                            <th className="py-1 text-right">Amount</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {row.fixedTasks.map((t, i) => (
                                            <tr key={i} className="border-t border-parchment/50">
                                              <td className="py-1 text-espresso">{t.task_name}</td>
                                              <td className="py-1 text-bark">{t.account || "—"}</td>
                                              <td className="py-1 text-center">
                                                {t.earned ? (
                                                  <span className="inline-block rounded-full bg-sage-soft px-2 py-0.5 text-[9px] font-semibold text-sage">
                                                    Earned
                                                  </span>
                                                ) : (
                                                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
                                                    Pending
                                                  </span>
                                                )}
                                              </td>
                                              <td className="py-1 text-right font-medium text-espresso">{fmtMoney(t.rate)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot>
                                          <tr className="border-t border-bark/20 font-semibold">
                                            <td className="py-1" colSpan={3}>Total Fixed</td>
                                            <td className="py-1 text-right text-terracotta">{fmtMoney(row.fixedPay)}</td>
                                          </tr>
                                          {row.earnedFixedPay < row.fixedPay && (
                                            <tr className="text-[10px]">
                                              <td className="py-0.5 text-bark/60" colSpan={3}>Earned so far</td>
                                              <td className="py-0.5 text-right text-sage font-medium">{fmtMoney(row.earnedFixedPay)}</td>
                                            </tr>
                                          )}
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}
                                </div>

                                {/* Payment history + summary */}
                                <div>
                                  {/* Earned vs Paid summary */}
                                  <div className="rounded-lg border border-sand bg-white p-3 mb-3">
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                      <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-bark">Earned</div>
                                        <div className="text-sm font-bold text-terracotta">{fmtMoney(row.grossPay)}</div>
                                      </div>
                                      <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-bark">Paid</div>
                                        <div className="text-sm font-bold text-emerald-600">{fmtMoney(row.totalPaid)}</div>
                                      </div>
                                      <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-bark">Balance Due</div>
                                        <div className={`text-sm font-bold ${row.balance > 0.01 ? "text-amber-600" : "text-sage"}`}>
                                          {fmtMoney(row.balance)}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-bark">
                                      Payment History
                                    </h4>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setShowVaPaymentModal(row.userId); }}
                                      className="rounded bg-terracotta px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-terracotta/80 cursor-pointer"
                                    >
                                      + Add Payment
                                    </button>
                                  </div>
                                  {row.payments.length === 0 ? (
                                    <p className="text-[11px] text-bark/50 italic">No payments recorded yet.</p>
                                  ) : (
                                    <table className="w-full text-[11px]">
                                      <thead>
                                        <tr className="text-[9px] font-semibold uppercase tracking-wider text-bark/60">
                                          <th className="py-1 text-left">Date</th>
                                          <th className="py-1 text-left">Method</th>
                                          <th className="py-1 text-left">Conf #</th>
                                          <th className="py-1 text-right">Amount</th>
                                          <th className="py-1 w-8"></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {row.payments.map((p) => (
                                          <tr key={p.id} className="border-t border-parchment/50">
                                            <td className="py-1.5 text-espresso">{fmtDateFull(p.payment_date)}</td>
                                            <td className="py-1.5 text-bark">{methodLabel(p.payment_method)}</td>
                                            <td className="py-1.5 text-bark">{p.confirmation_number || "—"}</td>
                                            <td className="py-1.5 text-right font-semibold text-emerald-600">{fmtMoney(Number(p.amount))}</td>
                                            <td className="py-1.5">
                                              <button
                                                onClick={(e) => { e.stopPropagation(); deleteVaPayment(p.id); }}
                                                className="text-red-400 hover:text-red-600 text-[10px] cursor-pointer"
                                                title="Delete"
                                              >
                                                ✕
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}

                                  {/* Category breakdown */}
                                  <div className="mt-3 text-[11px] text-bark/70">
                                    <span className="font-semibold text-bark">Categories:</span> {row.breakdown}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3" />
                      <td className="px-2 py-3">Total VA Cost</td>
                      <td className="px-3 py-3 text-right">
                        {fmtHours(vaCostData.totalPaidMs)}
                      </td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right text-terracotta">
                        {fmtMoney(vaCostData.totalCost)}
                      </td>
                      <td className="px-3 py-3 text-right text-emerald-600">
                        {fmtMoney(vaCostData.totalVaPaid)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {fmtMoney(vaCostData.totalCost - vaCostData.totalVaPaid)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* ── Expenses & Investments ─────────────────────── */}
          <Section
            title="Expenses & Investments"
            action={
              <button
                onClick={() => setShowExpenseModal(true)}
                className="rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors cursor-pointer"
              >
                + Add Expense
              </button>
            }
          >
            {/* Expense Filters */}
            <div className="border-b border-parchment px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-sand overflow-hidden text-[11px]">
                {(["all", "business", "reimbursable"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setExpenseTypeFilter(type)}
                    className={`px-3 py-1.5 font-medium capitalize transition-colors cursor-pointer ${
                      expenseTypeFilter === type
                        ? "bg-amber-600 text-white"
                        : "bg-white text-bark hover:bg-parchment"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <select
                value={expenseCategoryFilter}
                onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                className="rounded-lg border border-sand px-3 py-1.5 text-[11px] text-espresso outline-none focus:border-terracotta"
              >
                <option value="">All Categories</option>
                {expenseData.categories.map((c) => (
                  <option key={c} value={c}>{EXPENSE_CATEGORIES.find((ec) => ec.value === c)?.label ?? c}</option>
                ))}
              </select>
              <div className="text-[10px] text-bark/60 ml-auto">
                {expenseData.rows.length} expense{expenseData.rows.length !== 1 ? "s" : ""}
                {expenseTypeFilter !== "all" || expenseCategoryFilter ? " (filtered)" : ""}
              </div>
            </div>
            {expenseData.rows.length === 0 ? (
              <EmptyState text={expenseTypeFilter !== "all" || expenseCategoryFilter ? "No expenses match your filters." : "No expenses recorded for this period."} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                      <th className="px-4 py-3 cursor-pointer hover:text-terracotta" onClick={() => { if (expenseSortField === "date") setExpenseSortAsc(!expenseSortAsc); else { setExpenseSortField("date"); setExpenseSortAsc(false); } }}>
                        Date {expenseSortField === "date" ? (expenseSortAsc ? "↑" : "↓") : ""}
                      </th>
                      <th className="px-3 py-3">Description</th>
                      <th className="px-3 py-3">Account</th>
                      <th className="px-3 py-3 cursor-pointer hover:text-terracotta" onClick={() => { if (expenseSortField === "category") setExpenseSortAsc(!expenseSortAsc); else { setExpenseSortField("category"); setExpenseSortAsc(true); } }}>
                        Category {expenseSortField === "category" ? (expenseSortAsc ? "↑" : "↓") : ""}
                      </th>
                      <th className="px-3 py-3 text-right cursor-pointer hover:text-terracotta" onClick={() => { if (expenseSortField === "amount") setExpenseSortAsc(!expenseSortAsc); else { setExpenseSortField("amount"); setExpenseSortAsc(false); } }}>
                        Amount {expenseSortField === "amount" ? (expenseSortAsc ? "↑" : "↓") : ""}
                      </th>
                      <th className="px-3 py-3 text-center">Reimbursable</th>
                      <th className="px-3 py-3 text-center">Reimbursed</th>
                      <th className="px-3 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {expenseData.rows.map((exp) => (
                      <tr key={exp.id} className="hover:bg-parchment/20 transition-colors">
                        <td className="px-4 py-3 text-espresso">{fmtDateFull(exp.expense_date)}</td>
                        <td className="px-3 py-3 font-medium text-espresso max-w-[200px] truncate">{exp.description}</td>
                        <td className="px-3 py-3 text-bark">{exp.account || "General"}</td>
                        <td className="px-3 py-3 text-bark capitalize">{exp.category}</td>
                        <td className="px-3 py-3 text-right font-semibold text-amber-600">{fmtMoney(Number(exp.amount))}</td>
                        <td className="px-3 py-3 text-center">
                          {exp.is_reimbursable ? (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Yes</span>
                          ) : (
                            <span className="text-bark/40 text-[10px]">No</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {exp.is_reimbursable ? (
                            <button
                              onClick={() => toggleReimbursed(exp.id, exp.reimbursed)}
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${
                                exp.reimbursed
                                  ? "bg-sage-soft text-sage"
                                  : "bg-parchment text-bark hover:bg-amber-100 hover:text-amber-700"
                              }`}
                            >
                              {exp.reimbursed ? "Yes" : "No"}
                            </button>
                          ) : (
                            <span className="text-bark/40 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => deleteExpense(exp.id)}
                            className="text-red-400 hover:text-red-600 text-[10px] cursor-pointer"
                            title="Delete"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                      <td className="px-4 py-3" colSpan={4}>Total Expenses</td>
                      <td className="px-3 py-3 text-right text-amber-600">{fmtMoney(expenseData.totalExpenses)}</td>
                      <td className="px-3 py-3 text-center text-[10px] text-bark/60">
                        {fmtMoney(expenseData.reimbursableTotal)} reimbursable
                      </td>
                      <td className="px-3 py-3 text-center text-[10px] text-bark/60">
                        {fmtMoney(expenseData.reimbursedTotal)} collected
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

      {/* ── VA Payment Modal ────────────────────────────── */}
      {showVaPaymentModal !== null && (
        <PaymentModal
          title={`Record Payment to ${vaProfiles.find((p) => p.id === showVaPaymentModal)?.full_name || "VA"}`}
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setShowVaPaymentModal(null)}
          onSave={(form) => saveVaPayment(showVaPaymentModal, form)}
        />
      )}

      {/* ── Client Payment Modal ────────────────────────── */}
      {showClientPaymentModal !== null && (
        <ClientPaymentModal
          title={showClientPaymentModal ? `Record Payment from ${showClientPaymentModal}` : "Record Client Payment"}
          defaultAccount={showClientPaymentModal}
          accounts={activeAccountNames}
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setShowClientPaymentModal(null)}
          onSave={(form) => saveClientPayment(form.account || showClientPaymentModal, form)}
        />
      )}

      {/* ── Expense Modal ───────────────────────────────── */}
      {showExpenseModal && (
        <ExpenseModal
          accounts={activeAccountNames}
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setShowExpenseModal(false)}
          onSave={saveExpense}
        />
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

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sand bg-white overflow-hidden">
      <div className="border-b border-parchment bg-parchment/20 px-5 py-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-espresso">{title}</h3>
        {action}
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

/* ── Payment Modal (for VA payments) ──────────────────── */

function PaymentModal({
  title,
  defaultDate,
  onClose,
  onSave,
}: {
  title: string;
  defaultDate: string;
  onClose: () => void;
  onSave: (form: {
    amount: string; payment_date: string; payment_method: string;
    confirmation_number: string; notes: string;
  }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(defaultDate);
  const [method, setMethod] = useState("bank_transfer");
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) { alert("Please enter a valid amount."); return; }
    setSaving(true);
    await onSave({ amount, payment_date: paymentDate, payment_method: method, confirmation_number: confirmation, notes });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-sand bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-espresso mb-4">{title}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Date</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Confirmation / Check #</label>
            <input type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark hover:bg-parchment transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white hover:bg-terracotta/80 transition-colors disabled:opacity-50 cursor-pointer">
            {saving ? "Saving..." : "Save Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Client Payment Modal ─────────────────────────────── */

function ClientPaymentModal({
  title,
  defaultAccount,
  accounts,
  defaultDate,
  onClose,
  onSave,
}: {
  title: string;
  defaultAccount: string;
  accounts: string[];
  defaultDate: string;
  onClose: () => void;
  onSave: (form: {
    amount: string; payment_date: string; payment_method: string;
    confirmation_number: string; client_name: string; notes: string; account: string;
  }) => void;
}) {
  const [account, setAccount] = useState(defaultAccount);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(defaultDate);
  const [method, setMethod] = useState("bank_transfer");
  const [confirmation, setConfirmation] = useState("");
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) { alert("Please enter a valid amount."); return; }
    if (!account) { alert("Please select an account."); return; }
    setSaving(true);
    await onSave({ amount, payment_date: paymentDate, payment_method: method, confirmation_number: confirmation, client_name: clientName, notes, account });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-sand bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-espresso mb-4">{title}</h3>
        <div className="space-y-3">
          {!defaultAccount && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Account</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
                <option value="">Select account...</option>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Date</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Confirmation / Check #</label>
            <input type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Client Name</label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark hover:bg-parchment transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-lg bg-sage px-4 py-2 text-[12px] font-semibold text-white hover:bg-sage/80 transition-colors disabled:opacity-50 cursor-pointer">
            {saving ? "Saving..." : "Save Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Expense Modal ────────────────────────────────────── */

function ExpenseModal({
  accounts,
  defaultDate,
  onClose,
  onSave,
}: {
  accounts: string[];
  defaultDate: string;
  onClose: () => void;
  onSave: (form: {
    description: string; amount: string; expense_date: string;
    category: string; account: string; is_reimbursable: boolean; notes: string;
  }) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(defaultDate);
  const [category, setCategory] = useState("other");
  const [account, setAccount] = useState("");
  const [isReimbursable, setIsReimbursable] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!description) { alert("Please enter a description."); return; }
    if (!amount || parseFloat(amount) <= 0) { alert("Please enter a valid amount."); return; }
    setSaving(true);
    await onSave({ description, amount, expense_date: expenseDate, category, account, is_reimbursable: isReimbursable, notes });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-sand bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-espresso mb-4">Add Expense</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="e.g. Canva Pro subscription" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Amount ($)</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Date</label>
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
                {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Account (optional)</label>
              <select value={account} onChange={(e) => setAccount(e.target.value)}
                className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
                <option value="">General (no client)</option>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="reimbursable" checked={isReimbursable} onChange={(e) => setIsReimbursable(e.target.checked)}
              className="rounded border-sand" />
            <label htmlFor="reimbursable" className="text-[12px] text-bark cursor-pointer">
              This is reimbursable (can be billed to client)
            </label>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" placeholder="Optional" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark hover:bg-parchment transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-lg bg-amber-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50 cursor-pointer">
            {saving ? "Saving..." : "Save Expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
