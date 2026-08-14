"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// /admin/billing-automation — one place to generate paystub + recurring-invoice
// drafts and open each for review. No URLs, no email-hunting. Protected by the
// (admin) route group's server-side layout guard.

interface PaystubDraft {
  id: string;
  full_name: string;
  pay_period_label: string | null;
  period_start: string;
  period_end: string;
  total_hours_ms: number;
  gross_pay: number;
}

interface InvoiceDraft {
  id: number;
  invoice_number: string;
  to_name: string;
  total: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
}

function fmtMoney(n: number, currency = "USD") {
  return Number(n).toLocaleString("en-US", { style: "currency", currency });
}
function fmtHours(ms: number) { return (Number(ms) / 3_600_000).toFixed(2) + "h"; }

export default function BillingAutomationPage() {
  const supabase = createClient();
  const [paystubDrafts, setPaystubDrafts] = useState<PaystubDraft[]>([]);
  const [invoiceDrafts, setInvoiceDrafts] = useState<InvoiceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"paystub" | "invoice" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [ps, inv] = await Promise.all([
      supabase
        .from("paystub_snapshots")
        .select("id, full_name, pay_period_label, period_start, period_end, total_hours_ms, gross_pay")
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, to_name, total, currency, period_start, period_end")
        .eq("status", "draft")
        .not("recurring_series_id", "is", null)
        .order("created_at", { ascending: false }),
    ]);
    setPaystubDrafts((ps.data ?? []) as PaystubDraft[]);
    setInvoiceDrafts((inv.data ?? []) as InvoiceDraft[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const generate = async (which: "paystub" | "invoice") => {
    setBusy(which); setMsg(null);
    try {
      const url = which === "paystub" ? "/api/paystub/generate-drafts" : "/api/invoices/generate-recurring";
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) { setMsg({ kind: "err", text: json.error || "Generation failed." }); setBusy(null); return; }
      const label = which === "paystub" ? "paystub" : "invoice";
      setMsg({ kind: "ok", text: `Generated ${json.generated} ${label} draft${json.generated === 1 ? "" : "s"}${json.period?.label ? ` for ${json.period.label}` : ""}. They're listed below and a review copy was emailed to you.` });
      load();
    } catch (err) {
      setMsg({ kind: "err", text: String(err) });
    }
    setBusy(null);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-espresso">Billing Automation</h1>
        <p className="text-[13px] text-bark/70">
          Generate paystub and recurring-invoice drafts, then open each to review and send. Nothing goes to a VA or client until you approve it here.
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-3 text-[13px] ${msg.kind === "ok" ? "bg-sage-soft text-sage" : "bg-terracotta-soft text-terracotta"}`}>
          {msg.text}
        </div>
      )}

      {/* Paystubs */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <div className="border-b border-parchment bg-parchment/20 px-5 py-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-espresso">Paystub Drafts</h2>
            <p className="text-[11px] text-bark/60">Auto-runs on the 5th &amp; 20th — or generate now.</p>
          </div>
          <button
            onClick={() => generate("paystub")}
            disabled={busy !== null}
            className="rounded-lg bg-sage px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {busy === "paystub" ? "Generating…" : "Generate now"}
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-[13px] text-bark/50">Loading…</div>
        ) : paystubDrafts.length === 0 ? (
          <div className="p-6 text-[13px] text-bark/50">No paystub drafts waiting. Hit “Generate now” to create this period’s.</div>
        ) : (
          <ul className="divide-y divide-parchment">
            {paystubDrafts.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/paystub-review/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-parchment/20 transition-colors">
                  <div>
                    <div className="text-[13px] font-semibold text-espresso">{d.full_name}</div>
                    <div className="text-[11px] text-bark/70">{d.pay_period_label || `${d.period_start} → ${d.period_end}`} · {fmtHours(d.total_hours_ms)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-bold text-espresso">{fmtMoney(d.gross_pay)}</span>
                    <span className="text-[12px] font-semibold text-sage">Review →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recurring invoices */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <div className="border-b border-parchment bg-parchment/20 px-5 py-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-espresso">Recurring Invoice Drafts</h2>
            <p className="text-[11px] text-bark/60">Auto-runs on the 1st — or generate now.</p>
          </div>
          <button
            onClick={() => generate("invoice")}
            disabled={busy !== null}
            className="rounded-lg bg-sage px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {busy === "invoice" ? "Generating…" : "Generate now"}
          </button>
        </div>
        {loading ? (
          <div className="p-6 text-[13px] text-bark/50">Loading…</div>
        ) : invoiceDrafts.length === 0 ? (
          <div className="p-6 text-[13px] text-bark/50">No invoice drafts waiting. Only invoices marked “Repeat monthly” generate here.</div>
        ) : (
          <ul className="divide-y divide-parchment">
            {invoiceDrafts.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/invoice-review/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-parchment/20 transition-colors">
                  <div>
                    <div className="text-[13px] font-semibold text-espresso">{d.to_name}</div>
                    <div className="text-[11px] text-bark/70">{d.invoice_number}{d.period_start && d.period_end ? ` · ${d.period_start} → ${d.period_end}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-bold text-espresso">{fmtMoney(d.total, d.currency)}</span>
                    <span className="text-[12px] font-semibold text-sage">Review →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
