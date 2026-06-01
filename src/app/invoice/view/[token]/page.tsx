"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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
}

interface LineItem {
  description: string;
  va_name: string | null;
  quantity: number;
  project: string | null;
  account_name: string | null;
  client_memo: string | null;
  sort_order: number;
}

interface OrgSettings {
  registered_business_name: string | null;
  dba: string | null;
  timezone: string | null;
}

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

  const grossHours = lineItems.reduce((s, li) => s + Number(li.quantity), 0);
  const notBilledHours = Number(invoice.hours_not_billed || 0);
  const totalHours = grossHours - notBilledHours;
  const adjustment = Number(invoice.adjustment_amount || 0);
  const timezone = orgSettings?.timezone || "UTC";
  const orgRegisteredName = orgSettings?.registered_business_name || null;
  const orgDba = orgSettings?.dba || null;

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

        {/* Yellow Header */}
        <div className="rounded-t-xl bg-[#f5c842] px-8 py-7">
          <div className="flex justify-between gap-4">
            {/* Left */}
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#5a4000] mb-1">INVOICE: {issueDateFmt}</div>
              {invoice.service_type && <div className="text-[11px] italic text-[#5a4000] mb-2">{invoice.service_type}</div>}
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a4000] mb-1">BILL TO:</div>
              {invoice.account_name && <div className="text-[22px] font-extrabold text-[#2d1a00] leading-tight mb-0.5">{invoice.account_name}</div>}
              <div className={`font-extrabold text-[#2d1a00] leading-tight mb-1 ${invoice.account_name ? "text-[14px]" : "text-[22px]"}`}>{invoice.to_name}</div>
              {invoice.to_email && <div className="text-[12px] text-[#5a4000]">{invoice.to_email}</div>}
              {invoice.to_contact && <div className="text-[12px] text-[#5a4000]">{invoice.to_contact}</div>}
              <div className="mt-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#5a4000]">INVOICE AMOUNT</div>
                <div className="text-[28px] font-extrabold text-[#2d1a00]">{formatCurrency(Number(invoice.total), invoice.currency)}</div>
              </div>
            </div>
            {/* Right */}
            <div className="text-right shrink-0 max-w-[220px]">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[#5a4000] mb-1">INVOICE FROM:</div>
              <div className="text-[15px] font-bold text-[#2d1a00]">{invoice.from_name}</div>
              {orgRegisteredName && <div className="text-[12px] text-[#5a4000] mt-0.5">{orgRegisteredName}</div>}
              {orgDba && <div className="text-[11px] text-[#5a4000] mt-0.5">DBA: {orgDba}</div>}
              {invoice.from_phone && <div className="text-[12px] text-[#5a4000] mt-0.5">{invoice.from_phone}</div>}
              {invoice.from_email && <div className="text-[12px] text-[#5a4000] mt-0.5">{invoice.from_email}</div>}
              {invoice.payment_link && (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#5a4000] mb-1">Pay Online</div>
                  <a href={invoice.payment_link} target="_blank" rel="noopener noreferrer"
                    className="inline-block bg-[#2d1a00] text-[#f5c842] text-[12px] font-bold px-4 py-1.5 rounded hover:opacity-90 transition-opacity">
                    Click to Pay
                  </a>
                  <div className="text-[10px] text-[#5a4000] mt-1">*3% processing fee applies</div>
                </div>
              )}
              {invoice.payment_info && (
                <div className="mt-2 text-[11px] text-[#5a4000] whitespace-pre-line">{invoice.payment_info}</div>
              )}
              <div className="mt-3">
                <div className="text-[11px] font-bold text-[#2d1a00]">#{invoice.invoice_number}</div>
                {invoice.due_date && (
                  <div className="text-[11px] text-[#5a4000] mt-0.5">
                    Due: {new Date(invoice.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone })}
                  </div>
                )}
                <div className="mt-1">
                  <span className="text-[10px] font-bold uppercase" style={{ color: statusColor(invoice.status) }}>
                    {statusLabel(invoice.status)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Financial Breakdown */}
        <div className="bg-white border-x border-[#e8e0d4] px-6 py-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#6b5e52] mb-3">Invoice Financial Breakdown</div>
          {/* Row 1: Hours */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            {invoice.rate_amount != null && (
              <div className="rounded-lg border border-[#e8e0d4] bg-[#faf6f0] p-3 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Rate</div>
                <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">{formatCurrency(invoice.rate_amount, invoice.currency)}/hr</div>
              </div>
            )}
            {notBilledHours > 0 && (
              <div className="rounded-lg border border-[#e8e0d4] bg-[#faf6f0] p-3 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Gross Hours</div>
                <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">{grossHours.toFixed(2)}</div>
              </div>
            )}
            {notBilledHours > 0 && (
              <div className="rounded-lg border border-[#e8e0d4] bg-[#faf6f0] p-3 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">{invoice.hours_not_billed_label || "Not Billed"}</div>
                <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">{notBilledHours.toFixed(2)}</div>
              </div>
            )}
            <div className="rounded-lg border border-[#e8e0d4] bg-[#faf6f0] p-3 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Hours Billed</div>
              <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">{totalHours.toFixed(2)}</div>
            </div>
          </div>
          {/* Row 2: Money */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-[#e8e0d4] bg-[#f5f0e8] p-3 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Invoice Amount</div>
              <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">{formatCurrency(Number(invoice.subtotal), invoice.currency)}</div>
            </div>
            {adjustment > 0 && (
              <div className="rounded-lg border border-[#e8e0d4] bg-[#f5f0e8] p-3 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Savings</div>
                <div className="text-[14px] font-bold text-[#3d2b1f] mt-1">− {formatCurrency(adjustment)}</div>
              </div>
            )}
            <div className="rounded-lg border border-[#e8e0d4] bg-[#f5f0e8] p-3 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52]">Final Amount</div>
              <div className="text-[14px] font-bold text-[#c0704e] mt-1">{formatCurrency(Number(invoice.total), invoice.currency)}</div>
            </div>
          </div>
        </div>

        {/* Task Summary */}
        <div className="bg-[#2d3a4a] border-x border-[#1a2535] px-8 py-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5c842] mb-3">Task Summary</div>
          <div className="space-y-1">
            {taskSummary.map(([task, hrs]) => (
              <div key={task} className="flex justify-between gap-4">
                <span className="text-[12px] text-[#e8e0d4]">{task}</span>
                <span className="text-[12px] font-semibold text-white whitespace-nowrap">{fmtHours(hrs)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Deliverables */}
        <div className="bg-[#1e2a38] border-x border-[#1a2535] px-8 py-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5c842] mb-3">Deliverables / Objectives</div>
          <div className="space-y-1">
            {projSummary.map(([proj, hrs]) => (
              <div key={proj} className="flex justify-between gap-4">
                <span className="text-[12px] text-[#e8e0d4]">{proj}</span>
                <span className="text-[12px] font-semibold text-white whitespace-nowrap">{fmtHours(hrs)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="bg-white border-x border-[#e8e0d4] px-8 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6b5e52] mb-2">Notes</div>
            <div className="text-[13px] text-[#3d2b1f] whitespace-pre-line">{invoice.notes}</div>
          </div>
        )}

        {/* Detailed Time Allocation */}
        <div className="bg-[#faf6f0] border-x border-[#e8e0d4] px-6 py-3 mt-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#6b5e52]">Detailed Time Allocation</div>
        </div>
        <div className="bg-white border-x border-b border-[#e8e0d4] rounded-b-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf6f0]">
                <th className="px-3 py-2 text-right text-[9px] font-semibold uppercase tracking-wide text-[#6b5e52] border-b border-[#e8e0d4]">Mins</th>
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
        }
      `}</style>
    </div>
  );
}
