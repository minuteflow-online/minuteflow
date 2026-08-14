"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// /admin/paystub-review/[id] — review an auto-generated paystub DRAFT, see the
// daily breakdown, then approve (which sends the VA their paystub via the
// existing /api/paystub/send). Protected by the (admin) layout guard.

interface SnapshotRow {
  id: string;
  user_id: string;
  full_name: string;
  period_start: string;
  period_end: string;
  pay_period_label: string | null;
  total_hours_ms: number;
  pay_rate: number;
  gross_pay: number;
  by_date: Record<string, number | { ms: number; rate: number }> | null;
  status: string;
}

const PAYMENT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "bank_deposit", label: "Bank Deposit" },
  { value: "paypal", label: "PayPal" },
  { value: "remittance", label: "Remittance" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "zelle", label: "Zelle" },
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "venmo", label: "Venmo" },
  { value: "other", label: "Other" },
];

function fmtMoney(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function fmtHours(ms: number) { return (ms / 3_600_000).toFixed(2) + "h"; }
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
/** by_date value is a legacy number (ms) or {ms, rate}. */
function readDay(v: number | { ms: number; rate: number }, fallbackRate: number) {
  if (typeof v === "number") return { ms: v, rate: fallbackRate };
  return { ms: Number(v.ms) || 0, rate: Number(v.rate) || fallbackRate };
}

export default function PaystubReviewPage() {
  const params = useParams();
  const id = String(params.id);
  const supabase = createClient();

  const [snap, setSnap] = useState<SnapshotRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDays, setShowDays] = useState(true);
  const [method, setMethod] = useState("gcash");
  const [confInput, setConfInput] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("paystub_snapshots").select("*").eq("id", id).single();
    setSnap(data as SnapshotRow | null);
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-sm text-bark">Loading paystub…</div>;
  if (!snap) return <div className="p-8 text-sm text-terracotta">Paystub not found.</div>;

  const rate = Number(snap.pay_rate) || 0;
  const days = Object.entries(snap.by_date ?? {})
    .map(([date, v]) => {
      const { ms, rate: r } = readDay(v, rate);
      return { date, ms, rate: r, amount: (ms / 3_600_000) * r };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const alreadySent = snap.status === "sent" || done;
  const canApprove = !!confInput.trim() && !!method && !busy && !alreadySent;

  const approve = async () => {
    if (!canApprove) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/paystub/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: snap.user_id,
          start_date: snap.period_start,
          end_date: snap.period_end,
          pay_period_label: snap.pay_period_label,
          payment_method: method,
          confirmation_number: confInput.trim(),
          payment_date: payDate,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setMsg({ kind: "err", text: json.error || "Send failed." }); setBusy(false); return; }
      // Send route created the authoritative "sent" snapshot + recorded payment.
      // Remove this draft so it doesn't linger as a duplicate.
      await supabase.from("paystub_snapshots").delete().eq("id", id);
      setDone(true);
      setMsg({ kind: "ok", text: `Paystub sent to ${snap.full_name}${json.sentTo ? ` (${json.sentTo})` : ""} and payment recorded.` });
    } catch (err) {
      setMsg({ kind: "err", text: String(err) });
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-sand bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-bark">Paystub Review · Draft</div>
            <h1 className="text-xl font-bold text-espresso">{snap.full_name}</h1>
            <div className="text-[13px] text-bark mt-0.5">{snap.pay_period_label || `${snap.period_start} → ${snap.period_end}`}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-espresso">{fmtMoney(Number(snap.gross_pay))}</div>
            <div className="text-[12px] text-bark/70">{fmtHours(Number(snap.total_hours_ms))} · {fmtMoney(rate)}/hr</div>
          </div>
        </div>
      </div>

      {/* Daily breakdown (collapsible) */}
      <div className="rounded-xl border border-sand bg-white overflow-hidden">
        <button
          onClick={() => setShowDays((s) => !s)}
          className="w-full border-b border-parchment bg-parchment/20 px-5 py-3 flex items-center gap-2 text-left"
        >
          <span className={`text-bark text-[11px] transition-transform ${showDays ? "rotate-90" : ""}`}>▶</span>
          <h2 className="text-sm font-bold text-espresso flex-1">Daily Breakdown</h2>
          <span className="text-[12px] text-bark/70">{days.length} days · {fmtHours(Number(snap.total_hours_ms))}</span>
        </button>
        {showDays && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-parchment bg-parchment/30 text-[10px] font-semibold uppercase tracking-wider text-bark">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Hours</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment">
                {days.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-bark/50">No time logged this period.</td></tr>
                ) : days.map((d) => (
                  <tr key={d.date} className="hover:bg-parchment/20">
                    <td className="px-4 py-2.5 text-espresso">{fmtDate(d.date)}</td>
                    <td className="px-3 py-2.5 text-right text-bark">{fmtHours(d.ms)}</td>
                    <td className="px-3 py-2.5 text-right text-bark/70">{fmtMoney(d.rate)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-espresso">{fmtMoney(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-espresso/20 bg-parchment/20 font-semibold text-espresso">
                  <td className="px-4 py-2.5">Gross Pay</td>
                  <td className="px-3 py-2.5 text-right">{fmtHours(Number(snap.total_hours_ms))}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right">{fmtMoney(Number(snap.gross_pay))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Message */}
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-[13px] ${msg.kind === "ok" ? "bg-sage-soft text-sage" : "bg-terracotta-soft text-terracotta"}`}>
          {msg.text}
        </div>
      )}

      {/* Approve → send to VA */}
      <div className="rounded-xl border border-sand bg-white p-5 space-y-3">
        <div className="text-sm font-semibold text-espresso">Approve &amp; send to VA</div>
        <div className="text-[12px] text-bark/70">
          {alreadySent ? "Sent." : "Enter how you paid, then Approve — this emails the VA their paystub and records the payment."}
        </div>
        {!alreadySent && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta">
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Payment Date</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-bark mb-1">Confirmation #</label>
                <input value={confInput} onChange={(e) => setConfInput(e.target.value)} placeholder="Required"
                  className="w-full rounded-lg border border-sand px-3 py-2 text-[13px] text-espresso outline-none focus:border-terracotta" />
              </div>
            </div>
            <button
              onClick={approve}
              disabled={!canApprove}
              className="rounded-lg bg-sage px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-sage/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Sending…" : "Approve & send paystub"}
            </button>
            {!confInput.trim() && <p className="text-[11px] text-bark/60">Send stays locked until a confirmation # is entered.</p>}
          </>
        )}
      </div>
    </div>
  );
}
