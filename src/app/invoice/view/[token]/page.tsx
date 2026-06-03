"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

/* ── Types ───────────────────────────────────────────────── */

interface Invoice {
  id: string;
  invoice_number: string;
  from_name: string;
  from_phone: string | null;
  from_email: string | null;
  to_name: string;
  to_contact: string | null;
  to_email: string | null;
  to_phone: string | null;
  to_address: string | null;
  account_name: string | null;
  service_type: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  adjustment_amount: number | null;
  total: number;
  currency: string;
  notes: string | null;
  payment_link: string | null;
  payment_info: string | null;
  status: string;
  rate_amount: number | null;
  hours_not_billed: number | null;
  hours_not_billed_label: string | null;
  previous_balance: number | null;
  invoice_type?: string | null;
  custom_line_items?: string | null;
  period_start: string | null;
  period_end: string | null;
}

interface LineItem {
  description: string;
  va_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  project: string | null;
  account_name: string | null;
  client_memo: string | null;
  service_date: string | null;
  expense_id: number | null;
  sort_order: number;
}

interface OrgSettings {
  registered_business_name: string | null;
  dba: string | null;
  timezone: string | null;
}

type Tab = "summary" | "tasks" | "deliverables" | "time";

const ALL_TABS: { id: Tab; label: string; icon?: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "tasks", label: "Task Summary" },
  { id: "deliverables", label: "Deliverables" },
  { id: "time", label: "Time Allocation", icon: "⏱" },
];

/* ── Helpers ─────────────────────────────────────────────── */

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} hrs ${mins} mins` : `${hrs} hrs`;
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    draft: "Draft",
    ready_to_send: "Ready to Send",
    sent: "Sent",
    paid: "Paid",
    overdue: "Overdue",
  };
  return map[s] || s;
}

function statusColor(s: string) {
  const map: Record<string, string> = {
    draft: "#9e9080",
    ready_to_send: "#6b8fc4",
    sent: "#5a4000",
    paid: "#2d6a4f",
    overdue: "#c0704e",
  };
  return map[s] || "#9e9080";
}

/* ── Public invoice fetch (client-side via API route) ─────── */

export default function PublicInvoicePage() {
  const params = useParams();
  const token = params?.token as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [openExpenseNoteIdx, setOpenExpenseNoteIdx] = useState<number | null>(null);

  const activeTabRef = useRef<Tab>("summary");
  const timeTabStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invoices/public/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setInvoice(data.invoice);
          setLineItems(data.lineItems ?? []);
          setOrgSettings(data.orgSettings ?? null);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load invoice.");
        setLoading(false);
      });
  }, [token]);

  /* ── Tab time tracking ─────────────────────────────────── */

  const logTimeAllocationDuration = useCallback(() => {
    if (activeTabRef.current !== "time" || timeTabStartRef.current === null) return;
    const duration = Math.round((Date.now() - timeTabStartRef.current) / 1000);
    timeTabStartRef.current = null;
    if (duration < 1) return;
    try {
      navigator.sendBeacon(
        `/api/invoices/public/${token}/tab-view`,
        new Blob([JSON.stringify({ tab_name: "time_allocation", duration_seconds: duration })], {
          type: "application/json",
        })
      );
    } catch {
      // silently fail — tracking is non-critical
    }
  }, [token]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        logTimeAllocationDuration();
        if (activeTabRef.current === "time") {
          timeTabStartRef.current = Date.now();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      logTimeAllocationDuration();
    };
  }, [logTimeAllocationDuration]);

  const handleTabClick = (tab: Tab) => {
    if (activeTabRef.current === "time" && tab !== "time") {
      logTimeAllocationDuration();
    }
    if (tab === "time" && activeTabRef.current !== "time") {
      timeTabStartRef.current = Date.now();
    }
    activeTabRef.current = tab;
    setActiveTab(tab);
  };

  /* ── Loading / Error states ──────────────────────────── */

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8]">
        <div className="text-[#6b5e52]">Loading invoice…</div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8]">
        <div className="rounded-xl bg-white p-8 text-center shadow-sm">
          <div className="text-[18px] font-bold text-espresso mb-2">Invoice Not Found</div>
          <div className="text-[13px] text-[#6b5e52]">{error || "This link may have expired or the invoice no longer exists."}</div>
        </div>
      </div>
    );
  }

  /* ── Computed values ─────────────────────────────────── */

  const isCustomInvoice = invoice.invoice_type === "custom";
  const TABS = isCustomInvoice
    ? ALL_TABS.filter((t) => t.id === "summary")
    : ALL_TABS;

  const grossHours = lineItems.reduce((s, li) => s + Number(li.quantity), 0);
  const notBilledHours = Number(invoice.hours_not_billed || 0);
  const totalHours = grossHours - notBilledHours;
  const adjustment = Number(invoice.adjustment_amount || 0);
  const prevBalance = Number(invoice.previous_balance || 0);
  const timezone = orgSettings?.timezone || "UTC";
  const orgRegisteredName = orgSettings?.registered_business_name || null;
  const orgDba = orgSettings?.dba || null;

  // Smart display: only show Final Amount if there's an adjustment
  const hasAdjustment = adjustment > 0;
  // Current balance: invoice total + any previous unpaid balance
  const currentBalance = Number(invoice.total) + prevBalance;

  const issueDateFmt = new Date(invoice.issue_date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  });

  // Task summary
  const taskMap: Record<string, number> = {};
  lineItems.forEach((li) => {
    const k = li.description || "Other";
    taskMap[k] = (taskMap[k] || 0) + Number(li.quantity);
  });
  const taskSummary = Object.entries(taskMap).sort((a, b) => b[1] - a[1]);

  // Project summary
  const projMap: Record<string, number> = {};
  lineItems.forEach((li) => {
    const k = li.project || li.account_name || "Unassigned";
    projMap[k] = (projMap[k] || 0) + Number(li.quantity);
  });
  const projSummary = Object.entries(projMap).sort((a, b) => b[1] - a[1]);

  const hasPaymentInfo = invoice.payment_link || invoice.payment_info;

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#f5f0e8] py-8 px-4 font-sans">
      <div className="max-w-3xl mx-auto">

        {/* Print / Download button */}
        <div className="mb-4 flex justify-end print:hidden">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-[#2d3a4a] text-white text-[13px] font-bold px-5 py-2.5 hover:opacity-90 transition-opacity cursor-pointer"
          >
            Download / Print PDF
          </button>
        </div>

        {/* ── Yellow Header — 3 columns (stacked on mobile) ── */}
        <div className="rounded-t-xl bg-[#f5c842] px-6 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">

            {/* Col 1: Client Info */}
            <div className="flex flex-col sm:pr-5 pb-4 sm:pb-0 border-b sm:border-b-0 border-[#c9a820]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a4000] mb-1">BILL TO:</div>
              {invoice.account_name && (
                <div className="text-[18px] font-extrabold text-[#2d1a00] leading-tight mb-0.5">{invoice.account_name}</div>
              )}
              <div className={`font-extrabold text-[#2d1a00] leading-tight mb-1 ${invoice.account_name ? "text-[13px]" : "text-[18px]"}`}>
                {invoice.to_name}
              </div>
              {invoice.to_contact && <div className="text-[11px] text-[#5a4000]">{invoice.to_contact}</div>}
              {invoice.to_email && <div className="text-[11px] text-[#5a4000]">{invoice.to_email}</div>}
              {invoice.to_phone && <div className="text-[11px] text-[#5a4000]">{invoice.to_phone}</div>}
              {invoice.to_address && <div className="text-[10px] text-[#5a4000] mt-0.5">{invoice.to_address}</div>}
              <div className="mt-3">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[#5a4000]">
                  {currentBalance > Number(invoice.total) ? "Balance Due" : "Invoice Amount"}
                </div>
                <div className="text-[22px] font-extrabold text-[#2d1a00]">
                  {formatCurrency(currentBalance > Number(invoice.total) ? currentBalance : Number(invoice.total), invoice.currency)}
                </div>
                {invoice.service_type && (
                  <div className="text-[12px] font-semibold text-[#5a4000] mt-1">{invoice.service_type}</div>
                )}
                <div className="mt-2">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a4000]">Invoice Date</div>
                  <div className="text-[18px] font-extrabold text-[#2d1a00]">
                    {invoice.period_start && invoice.period_end
                      ? `${new Date(invoice.period_start + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(invoice.period_end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                      : issueDateFmt}
                  </div>
                </div>
              </div>
            </div>

            {/* Col 2: Invoice From */}
            <div className="flex flex-col border-x-0 sm:border-x border-[#c9a820] sm:px-5 py-4 sm:py-0 border-b sm:border-b-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[#5a4000] mb-1">INVOICE FROM:</div>
              <div className="text-[14px] font-bold text-[#2d1a00]">{invoice.from_name}</div>
              {orgRegisteredName && <div className="text-[12px] font-semibold text-[#2d1a00] mt-1">{orgRegisteredName}</div>}
              {orgDba && <div className="text-[11px] text-[#5a4000] mt-0.5">DBA: {orgDba}</div>}
              {invoice.from_phone && <div className="text-[11px] text-[#5a4000] mt-0.5">{invoice.from_phone}</div>}
              {invoice.from_email && <div className="text-[11px] text-[#5a4000] mt-0.5">{invoice.from_email}</div>}
              <div className="mt-3">
                <div className="text-[11px] font-bold text-[#2d1a00]">#{invoice.invoice_number}</div>
                {invoice.due_date && (
                  <div className="text-[10px] text-[#5a4000] mt-0.5">
                    Due: {new Date(invoice.due_date + "T12:00:00Z").toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric", timeZone: timezone,
                    })}
                  </div>
                )}
                <div className="mt-1">
                  <span className="text-[9px] font-bold uppercase" style={{ color: statusColor(invoice.status) }}>
                    {statusLabel(invoice.status)}
                  </span>
                </div>
              </div>
            </div>

            {/* Col 3: Payment Methods */}
            <div className="flex flex-col items-start sm:items-end text-left sm:text-right sm:pl-5 pt-4 sm:pt-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[#5a4000] mb-2">HOW TO PAY</div>
              {invoice.payment_info && (
                <div className="text-[11px] text-[#5a4000] whitespace-pre-line mb-2">{invoice.payment_info}</div>
              )}
              {invoice.payment_link && (
                <div className="mt-1">
                  <a
                    href={invoice.payment_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block bg-[#2d1a00] text-[#f5c842] text-[12px] font-bold px-4 py-1.5 rounded hover:opacity-90 transition-opacity"
                  >
                    Pay Online
                  </a>
                  <div className="text-[9px] text-[#5a4000] mt-1">*3% processing fee applies</div>
                </div>
              )}
              {!hasPaymentInfo && (
                <div className="text-[11px] text-[#7a6040] italic">Contact us for payment options</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="bg-white border-x border-t border-[#e8e0d4] print:hidden">
          <div className="flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex-1 py-3 px-1 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? "border-[#2d3a4a] text-[#2d3a4a] bg-white"
                    : "border-transparent text-[#9e9080] hover:text-[#6b5e52] bg-[#faf6f0]"
                }`}
              >
                {tab.label}
                {tab.icon && <span className="ml-1 text-[9px]">{tab.icon}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab: Summary ── */}
        <div className={`invoice-tab-section ${activeTab === "summary" ? "" : "hidden"}`}>
            {/* Financial Breakdown — smart 1 or 2 row layout */}
            <div className="bg-white border-x border-[#e8e0d4] px-6 py-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#6b5e52] mb-3">Invoice Financial Breakdown</div>
              {(() => {
                // Build a flat list of all items to display
                type BItem = { label: string; value: string; accent?: boolean };
                const reimbTotal = lineItems.filter((li) => li.expense_id).reduce((s, li) => s + Number(li.amount), 0);
                const allItems: BItem[] = [
                  ...(!isCustomInvoice ? [
                    ...(invoice.rate_amount != null ? [{ label: "Rate", value: `${formatCurrency(invoice.rate_amount, invoice.currency)}/hr` }] : []),
                    ...(notBilledHours > 0 ? [
                      { label: "Gross Hours", value: grossHours.toFixed(2) },
                      { label: invoice.hours_not_billed_label || "Not Billed", value: notBilledHours.toFixed(2) },
                    ] : []),
                    { label: "Hours Billed", value: totalHours.toFixed(2) },
                  ] : []),
                  { label: "Invoice Amount", value: formatCurrency(Number(invoice.subtotal), invoice.currency) },
                  ...(reimbTotal > 0 ? [{ label: "Reimbursable Expenses", value: formatCurrency(reimbTotal, invoice.currency) }] : []),
                  ...(hasAdjustment ? [
                    { label: "Savings", value: `− ${formatCurrency(adjustment)}` },
                    { label: "Final Amount", value: formatCurrency(Number(invoice.total), invoice.currency), accent: true },
                  ] : []),
                  ...(prevBalance > 0 ? [{ label: "Previous Balance", value: formatCurrency(prevBalance, invoice.currency) }] : []),
                ];

                const singleRow = allItems.length <= 4;
                const row1 = singleRow ? allItems : allItems.slice(0, Math.ceil(allItems.length / 2));
                const row2 = singleRow ? [] : allItems.slice(Math.ceil(allItems.length / 2));

                const renderRow = (rowItems: BItem[], bg: string) => (
                  <div className="flex gap-2 mb-2">
                    {rowItems.map(({ label, value, accent }) => (
                      <div key={label} className={`flex-1 rounded-lg border border-[#e8e0d4] ${bg} p-3 text-center`}>
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">{label}</div>
                        <div className={`text-[14px] font-bold mt-1 ${accent ? "text-[#c0704e]" : "text-[#3d2b1f]"}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                );

                return (
                  <>
                    {renderRow(row1, "bg-[#faf6f0]")}
                    {row2.length > 0 && renderRow(row2, "bg-[#f5f0e8]")}
                    {prevBalance > 0 && (
                      <div className="mt-1 rounded-lg border-2 border-[#c0704e] bg-[#fff8f5] p-3 text-center">
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Current Balance Due</div>
                        <div className="text-[18px] font-extrabold text-[#c0704e] mt-1">{formatCurrency(currentBalance, invoice.currency)}</div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Custom Invoice: Line Items */}
            {isCustomInvoice && invoice.custom_line_items && (
              <div className="bg-white border-x border-[#e8e0d4] px-6 py-4">
                <h3 className="mb-3 font-semibold text-espresso">Invoice Items</h3>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-sand text-[11px] font-semibold uppercase text-bark">
                      <th className="pb-2 text-left">Description</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(JSON.parse(invoice.custom_line_items as string) as Array<{description: string; amount: number}>).map((item, i) => (
                      <tr key={i} className="border-b border-parchment">
                        <td className="py-2 text-bark">{item.description}</td>
                        <td className="py-2 text-right font-medium text-espresso">${item.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Reimbursable Expenses — shown in Summary tab above task/deliverable tabs */}
            {lineItems.some((li) => li.expense_id) && (
              <div className="bg-white border-x border-[#e8e0d4] px-6 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#8a6a10] mb-3">Reimbursable Expenses</div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#f0e8d0] text-[10px] font-semibold uppercase tracking-wider text-[#8a6a10]">
                      <th className="pb-2 text-left px-1">Date</th>
                      <th className="pb-2 text-left px-2">Description</th>
                      <th className="pb-2 text-right px-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.filter((li) => li.expense_id).map((li, i) => (
                      <tr key={i} className="border-b border-[#faf6f0] last:border-0">
                        <td className="py-2 px-1 text-[#6b5e52] text-[11px] whitespace-nowrap">{li.service_date || "—"}</td>
                        <td className="py-2 px-2 text-[#3d2b1f]">
                          <span className="flex items-center gap-1">
                            {li.description}
                            {li.client_memo && (
                              <span className="relative inline-block flex-shrink-0">
                                <button
                                  onClick={() => setOpenExpenseNoteIdx(openExpenseNoteIdx === i ? null : i)}
                                  className="w-4 h-4 rounded-full bg-[#e8d8a0] text-[#8a6a10] text-[9px] font-bold inline-flex items-center justify-center hover:bg-[#d4c070] cursor-pointer leading-none"
                                >?</button>
                                {openExpenseNoteIdx === i && (
                                  <div className="absolute z-20 left-5 top-0 bg-white border border-[#e8d8a0] rounded-lg shadow-lg p-2.5 text-[11px] text-[#3d2b1f] w-52 whitespace-pre-wrap">
                                    {li.client_memo}
                                  </div>
                                )}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 px-1 text-right font-semibold text-[#3d2b1f]">{formatCurrency(Number(li.amount), invoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#e8d8a0]">
                      <td colSpan={2} className="pt-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a6a10]">Total Reimbursable</td>
                      <td className="pt-2 px-1 text-right font-bold text-[#3d2b1f]">
                        {formatCurrency(lineItems.filter((li) => li.expense_id).reduce((s, li) => s + Number(li.amount), 0), invoice.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="bg-white border-x border-[#e8e0d4] px-8 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6b5e52] mb-2">Notes</div>
                <div className="text-[13px] text-[#3d2b1f] whitespace-pre-line">{invoice.notes}</div>
              </div>
            )}

            {/* Bottom border */}
            <div className="bg-white border-x border-b border-[#e8e0d4] rounded-b-xl h-4" />
        </div>

        {/* ── Tab: Task Summary ── */}
        <div className={`invoice-tab-section ${activeTab === "tasks" ? "" : "hidden"}`}>
          <div className="bg-[#2d3a4a] border-x border-b border-[#1a2535] rounded-b-xl px-8 py-6">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5c842] mb-4">Task Summary</div>
            <div className="space-y-2">
              {taskSummary.map(([task, hrs]) => (
                <div key={task} className="flex justify-between gap-4 border-b border-[#3d4f62] pb-2 last:border-0 last:pb-0">
                  <span className="text-[13px] text-[#e8e0d4]">{task}</span>
                  <span className="text-[13px] font-semibold text-white whitespace-nowrap">{fmtHours(hrs)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-[#3d4f62] flex justify-between">
              <span className="text-[11px] font-semibold text-[#a8b8c8] uppercase tracking-wide">Total Billed</span>
              <span className="text-[14px] font-bold text-[#f5c842]">{fmtHours(totalHours)}</span>
            </div>
          </div>
        </div>

        {/* ── Tab: Deliverables ── */}
        <div className={`invoice-tab-section ${activeTab === "deliverables" ? "" : "hidden"}`}>
          <div className="bg-[#1e2a38] border-x border-b border-[#1a2535] rounded-b-xl px-8 py-6">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5c842] mb-4">Deliverables / Objectives</div>
            <div className="space-y-2">
              {projSummary.map(([proj, hrs]) => (
                <div key={proj} className="flex justify-between gap-4 border-b border-[#2d3a4a] pb-2 last:border-0 last:pb-0">
                  <span className="text-[13px] text-[#e8e0d4]">{proj}</span>
                  <span className="text-[13px] font-semibold text-white whitespace-nowrap">{fmtHours(hrs)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-[#2d3a4a] flex justify-between">
              <span className="text-[11px] font-semibold text-[#a8b8c8] uppercase tracking-wide">Total Billed</span>
              <span className="text-[14px] font-bold text-[#f5c842]">{fmtHours(totalHours)}</span>
            </div>
          </div>
        </div>

        {/* ── Tab: Time Allocation ── */}
        <div className={`invoice-tab-section ${activeTab === "time" ? "" : "hidden"}`}>
            <div className="bg-[#faf6f0] border-x border-[#e8e0d4] px-6 py-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#6b5e52]">Detailed Time Allocation</div>
                <div className="text-[10px] text-[#9e9080]">{lineItems.length} entries · {fmtHours(grossHours)} gross</div>
              </div>
            </div>
            <div className="bg-white border-x border-b border-[#e8e0d4] rounded-b-xl overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#faf6f0]">
                    <th className="px-3 py-2 text-right text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52] border-b border-[#e8e0d4] whitespace-nowrap">Mins</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52] border-b border-[#e8e0d4]">Task</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52] border-b border-[#e8e0d4]">Deliverable</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52] border-b border-[#e8e0d4]">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#fafaf8]"}>
                      <td className="px-3 py-1.5 text-right text-[11px] font-semibold text-[#3d2b1f] border-b border-[#e8e0d4]">{Math.round(Number(li.quantity) * 60)}</td>
                      <td className="px-3 py-1.5 text-[11px] text-[#3d2b1f] border-b border-[#e8e0d4]">{li.description}</td>
                      <td className="px-3 py-1.5 text-[11px] text-[#6b5e52] border-b border-[#e8e0d4]">{li.project || li.account_name || "—"}</td>
                      <td className="px-3 py-1.5 text-[10px] text-[#6b5e52] border-b border-[#e8e0d4]">{li.client_memo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </div>

        {/* Footer */}
        <div className="py-6 text-center">
          <div className="text-[11px] text-[#9e9080]">Sent by {invoice.from_name} · MinuteFlow</div>
        </div>

      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .invoice-tab-section { display: block !important; }
        }
      `}</style>
    </div>
  );
}
