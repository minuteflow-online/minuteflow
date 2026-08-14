"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// /admin/invoice-review/[id] — review a recurring-invoice draft, then Send.
// Opened from the review email. Protection comes from the (admin) route group's
// server-side layout guard (role must be "admin"), not from this page.
//
// Flow: Approve (soft flag) · type the emailed send-code to unlock Send (calls
// the existing /api/invoices/send) · enter the payment confirmation # to
// Complete (marks the invoice paid — which unblocks the next fixed invoice).

interface InvoiceRow {
  id: number;
  invoice_number: string;
  to_name: string;
  to_email: string | null;
  account_name: string | null;
  status: string;
  review_status: string | null;
  send_code: string | null;
  confirmation_number: string | null;
  invoice_type: "timelog" | "custom" | null;
  currency: string;
  subtotal: number;
  total: number;
  rate_amount: number | null;
  custom_line_items: string | null;
  period_start: string | null;
  period_end: string | null;
  recurring_series_id: string | null;
}

interface LineItemRow {
  id: number;
  description: string;
  va_name: string | null;
  quantity: number;
  service_date: string | null;
}

function fmtMoney(n: number, currency = "USD") {
  return n.toLocaleString("en-US", { style: "currency", currency });
}

const SENT_STATUSES = ["sent", "paid", "partially_paid", "overdue"];

export default function InvoiceReviewPage() {
  const params = useParams();
  const id = Number(params.id);
  const supabase = createClient();

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [items, setItems] = useState<LineItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState("");
  const [confInput, setConfInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Previous invoice in this recurring series that isn't paid yet — blocks Send.
  const [prevUnpaid, setPrevUnpaid] = useState<{ number: string; status: string } | null>(null);

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).single();
    setInvoice(inv as InvoiceRow | null);
    setConfInput((inv?.confirmation_number as string) || "");
    const { data: li } = await supabase
      .from("invoice_line_items")
      .select("id, description, va_name, quantity, service_date")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true });
    setItems((li ?? []) as LineItemRow[]);

    // Rule: don't send a new recurring invoice until the previous one is paid.
    setPrevUnpaid(null);
    if (inv?.recurring_series_id && inv?.period_start) {
      const { data: prev } = await supabase
        .from("invoices")
        .select("invoice_number, status, period_start")
        .eq("recurring_series_id", inv.recurring_series_id)
        .lt("period_start", inv.period_start)
        .not("status", "in", '("cancelled","trash")')
        .order("period_start", { ascending: false })
        .limit(1);
      const p = prev?.[0];
      if (p && p.status !== "paid") setPrevUnpaid({ number: p.invoice_number as string, status: p.status as string });
    }
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { if (!Number.isNaN(id)) load(); }, [id, load]);

  if (loading) {
    return <div className="p-8 text-sm text-bark">Loading invoice…</div>;
  }
  if (!invoice) {
    return <div className="p-8 text-sm text-terracotta">Invoice not found.</div>;
  }

  const rate = Number(invoice.rate_amount) || 0;
  const isHourly = (invoice.invoice_type ?? "custom") === "timelog";
  const alreadySent = SENT_STATUSES.includes(invoice.status);
  const isPaid = invoice.status === "paid";
  const codeOk = !!invoice.send_code && codeInput.trim().toUpperCase() === invoice.send_code.toUpperCase();

  // Fixed invoices carry their line items as a JSON string
  let customItems: { description: string; amount: number }[] = [];
  if (!isHourly && invoice.custom_line_items) {
    try {
      const parsed = JSON.parse(invoice.custom_line_items);
      if (Array.isArray(parsed)) customItems = parsed;
    } catch { /* ignore malformed */ }
  }

  const totalHours = items.reduce((s, li) => s + Number(li.quantity), 0);

  const approve = async () => {
    setBusy("approve"); setMsg(null);
    const { error } = await supabase.from("invoices").update({ review_status: "approved" }).eq("id", id);
    setBusy(null);
    if (error) { setMsg({ kind: "err", text: error.message }); return; }
    setMsg({ kind: "ok", text: "Marked approved for review." });
    load();
  };

  const send = async () => {
    if (!codeOk || prevUnpaid) return;
    setBusy("send"); setMsg(null);
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: id }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg({ kind: "err", text: json.error || "Send failed." }); setBusy(null); return; }
      await supabase.from("invoices").update({ review_status: "sent" }).eq("id", id);
      setCodeInput("");
      setMsg({ kind: "ok", text: `Invoice ${invoice.invoice_number} sent to ${invoice.to_name}.` });
      load();
    } catch (err) {
      setMsg({ kind: "err", text: String(err) });
    }
    setBusy(null);
  };

  const complete = async () => {
    if (!confInput.trim()) return;
    setBusy("complete"); setMsg(null);
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "paid",
        confirmation_number: confInput.trim(),
        amount_paid: invoice.total,
        paid_date: new Date().toISOString().split("T")[0],
      })
      .eq("id", id);
    setBusy(null);
    if (error) { setMsg({ kind: "err", text: error.message }); return; }
    setMsg({ kind: "ok", text: "Invoice marked paid — the next recurring invoice can now generate." });
    load();
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-sand bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-bark">Invoice Review</div>
            <h1 className="text-xl font-bold text-espresso">{invoice.invoice_number}</h1>
            <div className="text-[13px] text-bark mt-0.5">
              Bill to <span className="font-semibold text-espresso">{invoice.to_name}</span>
              {invoice.account_name ? ` · ${invoice.account_name}` : ""}
            </div>
            {invoice.period_start && invoice.period_end && (
              <div className="text-[12px] text-bark/70 mt-0.5">Period: {invoice.period_start} → {invoice.period_end}</div>
            )}
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isPaid ? "bg-sage-soft text-sage"
              : alreadySent ? "bg-sky-50 text-sky-600"
              : "bg-amber-50 text-amber-600"
            }`}>
              {invoice.status}
            </span>
            <div className="mt-2 text-2xl font-bold text-espresso">{fmtMoney(Number(invoice.total), invoice.currency)}</div>
            {isHourly && <div className="text-[12px] text-bark/70">{totalHours.toFixed(2)}h @ {fmtMoney(rate, invoice.currency)}/hr</div>}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <div className="border-b border-parchment bg-parchment/20 px-5 py-3">
          <h2 className="text-sm font-bold text-espresso">{isHourly ? "Time Entries" : "Line Items"}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                <th className="px-4 py-2.5">Description</th>
                {isHourly && <th className="px-3 py-2.5">Date</th>}
                {isHourly && <th className="px-3 py-2.5 text-right">Hours</th>}
                <th className="px-3 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment">
              {isHourly ? (
                items.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-bark/50">No billable time logged for this period.</td></tr>
                ) : items.map((li) => (
                  <tr key={li.id} className="hover:bg-parchment/20">
                    <td className="px-4 py-2.5 text-espresso">{li.description}{li.va_name ? <span className="text-bark/60"> · {li.va_name}</span> : ""}</td>
                    <td className="px-3 py-2.5 text-bark">{li.service_date ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-bark">{Number(li.quantity).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-espresso">{fmtMoney(Number(li.quantity) * rate, invoice.currency)}</td>
                  </tr>
                ))
              ) : (
                customItems.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-6 text-center text-bark/50">No line items.</td></tr>
                ) : customItems.map((ci, i) => (
                  <tr key={i} className="hover:bg-parchment/20">
                    <td className="px-4 py-2.5 text-espresso">{ci.description}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-espresso">{fmtMoney(Number(ci.amount), invoice.currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                <td className="px-4 py-2.5" colSpan={isHourly ? 3 : 1}>Total</td>
                <td className="px-3 py-2.5 text-right">{fmtMoney(Number(invoice.total), invoice.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-[13px] ${msg.kind === "ok" ? "bg-sage-soft text-sage" : "bg-terracotta-soft text-terracotta"}`}>
          {msg.text}
        </div>
      )}

      {/* Actions */}
      <div className="rounded-xl border border-sand bg-white p-5 space-y-5">
        {/* Approve */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-espresso">Approved for review</div>
            <div className="text-[12px] text-bark/70">Flag this draft as looked-over. Doesn&apos;t send anything.</div>
          </div>
          <button
            onClick={approve}
            disabled={busy === "approve"}
            className={`rounded-lg px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
              invoice.review_status === "approved" ? "bg-sage-soft text-sage" : "bg-stone/10 text-stone hover:bg-stone/20"
            }`}
          >
            {invoice.review_status === "approved" ? "✓ Approved" : "Approve"}
          </button>
        </div>

        <div className="border-t border-parchment" />

        {/* Send (gated by send-code) */}
        <div>
          <div className="text-sm font-semibold text-espresso">Send to client</div>
          <div className="text-[12px] text-bark/70 mb-2">
            {alreadySent
              ? "Already sent."
              : "Type the send-code from your email to unlock Send — this prevents accidental sends."}
          </div>
          {!alreadySent && prevUnpaid && (
            <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-700">
              Previous invoice <span className="font-semibold">{prevUnpaid.number}</span> in this series is <span className="font-semibold">{prevUnpaid.status}</span>, not paid. Mark it paid before sending this one.
            </div>
          )}
          {!alreadySent && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Send code"
                disabled={!!prevUnpaid}
                className="rounded-lg border border-sand px-3 py-2 text-[13px] uppercase tracking-widest text-espresso outline-none focus:border-terracotta w-36 disabled:bg-parchment disabled:opacity-60"
              />
              <button
                onClick={send}
                disabled={!codeOk || !!prevUnpaid || busy === "send"}
                className="rounded-lg bg-sage px-4 py-2 text-[12px] font-semibold text-white hover:bg-sage/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
              {codeInput && !codeOk && <span className="text-[11px] text-terracotta">Code doesn&apos;t match</span>}
            </div>
          )}
        </div>

        <div className="border-t border-parchment" />

        {/* Complete (confirmation number) */}
        <div>
          <div className="text-sm font-semibold text-espresso">Complete invoice</div>
          <div className="text-[12px] text-bark/70 mb-2">
            {isPaid
              ? `Paid — confirmation ${invoice.confirmation_number ?? "on file"}.`
              : "Enter the payment confirmation number to mark this invoice paid."}
          </div>
          {!isPaid && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={confInput}
                onChange={(e) => setConfInput(e.target.value)}
                placeholder="Confirmation #"
                className="rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta w-44"
              />
              <button
                onClick={complete}
                disabled={!confInput.trim() || busy === "complete"}
                className="rounded-lg bg-espresso px-4 py-2 text-[12px] font-semibold text-white hover:bg-espresso/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "complete" ? "Saving…" : "Mark Paid"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
