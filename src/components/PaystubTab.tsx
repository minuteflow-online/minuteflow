"use client";

import React, { useState, useCallback, useEffect } from "react";
import type { Profile } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface Props {
  profiles: Profile[];
  orgTimezone: string;
  orgName?: string;
}

type PeriodPreset = "this_week" | "last_week" | "this_first_half" | "this_second_half" | "last_first_half" | "last_second_half" | "this_month" | "last_month" | "custom";

interface PreviousPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  notes: string | null;
  confirmation_number: string | null;
}

interface FixedAssignment {
  id: number;
  task_name: string;
  account: string;
  project: string;
  rate: number;
  quantity: number;
  amount: number;
  status: string;
}

interface PreviewData {
  vaName: string;
  vaEmail: string;
  payPeriod: string;
  totalHours: number;
  payRate: number;
  grossPay: number;
  byDate: Record<string, number>;
  fixedAssignments: FixedAssignment[];
  fixedTotal: number;
  totalGrossPay: number;
  paymentAccounts?: Record<string, Record<string, string>>;
  previousPayments: PreviousPayment[];
  previousTotal: number;
}

interface PaystubSnapshot {
  id: string;
  user_id: string;
  full_name: string;
  period_start: string;
  period_end: string;
  pay_period_label: string;
  sent_at: string;
  total_hours_ms: number;
  pay_rate: number;
  gross_pay: number;
  amount_paid: number;
  payment_method: string | null;
  confirmation_number: string | null;
  payment_date: string | null;
  by_date: Record<string, number>;
  email_sent_to: string;
  company_name: string;
  personal_message: string | null;
  paystub_link: string | null;
}

/* ── Date helpers ─────────────────────────────────────────── */

function toLocalDate(d: Date, tz: string): Date {
  // Get the date in the target timezone as a "local" date
  const str = d.toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
  return new Date(str + "T00:00:00");
}

function dateToIso(d: Date): string {
  // Returns "YYYY-MM-DD" from a local Date
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getPeriodRange(preset: PeriodPreset, tz: string): { start: string; end: string; label: string } {
  const now = new Date();
  const local = toLocalDate(now, tz);
  const dow = local.getDay(); // 0=Sun, 1=Mon, ...

  function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function fmt(iso: string): string {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  }

  if (preset === "this_week") {
    // Mon–Sun week
    const mon = addDays(local, -(dow === 0 ? 6 : dow - 1));
    const sun = addDays(mon, 6);
    const start = dateToIso(mon);
    const end = dateToIso(sun);
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "last_week") {
    const mon = addDays(local, -(dow === 0 ? 6 : dow - 1) - 7);
    const sun = addDays(mon, 6);
    const start = dateToIso(mon);
    const end = dateToIso(sun);
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "this_first_half") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo, 1));
    const end = dateToIso(new Date(yr, mo, 15));
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "this_second_half") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo, 16));
    const end = dateToIso(new Date(yr, mo + 1, 0)); // last day of month
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "last_first_half") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo - 1, 1));
    const end = dateToIso(new Date(yr, mo - 1, 15));
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "last_second_half") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo - 1, 16));
    const end = dateToIso(new Date(yr, mo, 0)); // last day of prev month
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "this_month") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo, 1));
    const end = dateToIso(new Date(yr, mo + 1, 0));
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  if (preset === "last_month") {
    const yr = local.getFullYear();
    const mo = local.getMonth();
    const start = dateToIso(new Date(yr, mo - 1, 1));
    const end = dateToIso(new Date(yr, mo, 0));
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }

  // custom — caller provides dates directly
  return { start: "", end: "", label: "Custom" };
}

function formatHours(ms: number): string {
  return (ms / 3_600_000).toFixed(2) + " hrs";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDateLabel(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

/* ── Component ───────────────────────────────────────────── */

export default function PaystubTab({ profiles, orgTimezone, orgName }: Props) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [preset, setPreset] = useState<PeriodPreset>("last_second_half");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentWarning, setPaymentWarning] = useState<string | null>(null);

  // Company name (editable, shown on paystub email)
  const [companyName, setCompanyName] = useState<string>(orgName || "MinuteFlow");

  // Miscellaneous amount (added on top of Amount to Pay)
  const [miscAmount, setMiscAmount] = useState<string>("");

  // Payment fields
  const todayIso = new Date().toLocaleDateString("en-CA");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("gcash");
  const [personalMessage, setPersonalMessage] = useState<string>("");
  const [confirmationNumber, setConfirmationNumber] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(todayIso);

  // Paystub history
  const [history, setHistory] = useState<PaystubSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingSnapId, setEditingSnapId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendSuccessId, setResendSuccessId] = useState<string | null>(null);

  // Editable payment fields (post-send, in expanded history row)
  const [editInputs, setEditInputs] = useState<Record<string, {
    payment_method: string;
    confirmation_number: string;
    payment_date: string;
    personal_message: string;
  }>>({});
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [savedEditId, setSavedEditId] = useState<string | null>(null);

  // Only show active profiles with a pay rate
  const eligibleProfiles = profiles.filter((p) => p.is_active);

  const selectedProfile = eligibleProfiles.find((p) => p.id === selectedUserId) ?? null;

  function getRange(): { start: string; end: string; label: string } | null {
    if (preset === "custom") {
      if (!customStart || !customEnd) return null;
      const fmt = (iso: string) =>
        new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
        });
      return { start: customStart, end: customEnd, label: `${fmt(customStart)} – ${fmt(customEnd)}` };
    }
    return getPeriodRange(preset, orgTimezone);
  }

  const handleCalculate = useCallback(async () => {
    setError(null);
    setPreview(null);
    setSent(false);

    if (!selectedUserId) { setError("Please select a VA."); return; }
    const range = getRange();
    if (!range || !range.start || !range.end) { setError("Please select a valid pay period."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/paystub/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserId,
          start_date: range.start,
          end_date: range.end,
          pay_period_label: range.label,
          preview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to calculate.");
      setPreview(data);
      // Default amount = total gross pay (hourly + fixed)
      const net = data.totalGrossPay || data.grossPay;
      setCustomAmount(net.toFixed(2));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [selectedUserId, preset, customStart, customEnd, orgTimezone]);

  const handleSend = useCallback(async () => {
    if (!preview) return;
    setError(null);
    setPaymentWarning(null);
    setSending(true);

    const range = getRange();
    if (!range) return;

    try {
      const res = await fetch("/api/paystub/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserId,
          start_date: range.start,
          end_date: range.end,
          pay_period_label: range.label,
          preview: false,
          payment_method: paymentMethod,
          confirmation_number: confirmationNumber || null,
          payment_date: paymentDate,
          personal_message: personalMessage.trim() || null,
          custom_amount: (() => {
            const base = customAmount !== "" ? parseFloat(customAmount) : (preview?.totalGrossPay ?? preview?.grossPay ?? 0);
            const misc = miscAmount !== "" ? parseFloat(miscAmount) : 0;
            return base + misc;
          })(),
          company_name: companyName.trim() || "MinuteFlow",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send.");
      setSent(true);
      fetchHistory(selectedUserId);
      // Show warnings for partial failures
      if (data.paymentError && data.emailError) {
        setPaymentWarning(`Both payment recording and email failed. Please log this payment manually in the Financial page.`);
      } else if (data.paymentError) {
        setPaymentWarning(`Paystub emailed, but payment record failed to save: ${data.paymentError}. Please log this payment manually.`);
      } else if (data.emailError) {
        setPaymentWarning(`Payment recorded ✓, but paystub email failed to send: ${data.emailError}. You may need to notify ${preview?.vaName} directly.`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }, [preview, selectedUserId, preset, customStart, customEnd, orgTimezone, paymentMethod, confirmationNumber, paymentDate, personalMessage, customAmount, miscAmount, companyName]);

  const handleResend = useCallback(async (snap: PaystubSnapshot) => {
    setResendingId(snap.id);
    setResendSuccessId(null);
    try {
      const res = await fetch("/api/paystub/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: snap.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend.");
      setResendSuccessId(snap.id);
      setTimeout(() => setResendSuccessId(null), 4000);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Resend failed.");
    } finally {
      setResendingId(null);
    }
  }, []);

  function getEditValues(snap: PaystubSnapshot) {
    return editInputs[snap.id] ?? {
      payment_method: snap.payment_method ?? "gcash",
      confirmation_number: snap.confirmation_number ?? "",
      payment_date: snap.payment_date ?? "",
      personal_message: snap.personal_message ?? "",
    };
  }

  const handleSaveEdit = useCallback(async (snap: PaystubSnapshot) => {
    const values = getEditValues(snap);
    setSavingEditId(snap.id);
    setSavedEditId(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("paystub_snapshots")
        .update({
          payment_method: values.payment_method || null,
          confirmation_number: values.confirmation_number.trim() || null,
          payment_date: values.payment_date || null,
          personal_message: values.personal_message.trim() || null,
        })
        .eq("id", snap.id);
      if (updateError) throw new Error(updateError.message);

      setHistory((prev) =>
        prev.map((s) =>
          s.id === snap.id
            ? {
                ...s,
                payment_method: values.payment_method || null,
                confirmation_number: values.confirmation_number.trim() || null,
                payment_date: values.payment_date || null,
                personal_message: values.personal_message.trim() || null,
              }
            : s
        )
      );
      setSavedEditId(snap.id);
      setEditingSnapId(null);
      setTimeout(() => setSavedEditId(null), 3000);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingEditId(null);
    }
  }, [editInputs]);

  const fetchHistory = useCallback(async (userId: string) => {
    if (!userId) { setHistory([]); return; }
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/paystub/history?user_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch {
      // non-fatal
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load history when VA selection changes
  useEffect(() => {
    fetchHistory(selectedUserId);
    setExpandedId(null);
  }, [selectedUserId, fetchHistory]);

  const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
    { value: "this_week", label: "This Week (Mon–Sun)" },
    { value: "last_week", label: "Last Week (Mon–Sun)" },
    { value: "this_first_half", label: "This Month: 1st Half (1–15)" },
    { value: "this_second_half", label: "This Month: 2nd Half (16–end)" },
    { value: "last_first_half", label: "Last Month: 1st Half (1–15)" },
    { value: "last_second_half", label: "Last Month: 2nd Half (16–end)" },
    { value: "this_month", label: "This Month (Full)" },
    { value: "last_month", label: "Last Month (Full)" },
    { value: "custom", label: "Custom Range" },
  ];

  const range = getRange();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-bark">Send Paystub</h2>
        <p className="text-sm text-bark/60 mt-1">
          Calculate hours and gross pay for a VA, preview the paystub, then send it to their email.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Inputs */}
        <div className="space-y-4">
          {/* VA Selector */}
          <div>
            <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
              Virtual Assistant
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => { setSelectedUserId(e.target.value); setPreview(null); setSent(false); }}
              className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
            >
              <option value="">— Select VA —</option>
              {eligibleProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.pay_rate > 0 ? `$${Number(p.pay_rate).toFixed(2)}/hr` : "no rate set"})
                </option>
              ))}
            </select>
          </div>

          {/* Period Preset */}
          <div>
            <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
              Pay Period
            </label>
            <select
              value={preset}
              onChange={(e) => { setPreset(e.target.value as PeriodPreset); setPreview(null); setSent(false); }}
              className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
            >
              {PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Custom date inputs */}
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">Start Date</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => { setCustomStart(e.target.value); setPreview(null); setSent(false); }}
                  className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">End Date</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => { setCustomEnd(e.target.value); setPreview(null); setSent(false); }}
                  className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                />
              </div>
            </div>
          )}

          {/* Resolved range display */}
          {range && range.start && (
            <p className="text-xs text-bark/50">
              Period: <span className="font-medium text-bark/70">{range.label}</span>
            </p>
          )}

          {/* Company Name */}
          <div>
            <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
              Company Name <span className="normal-case font-normal text-bark/40">(shown on paystub)</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. MinuteFlow"
              className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
            />
          </div>

          {/* Calculate button */}
          <button
            onClick={handleCalculate}
            disabled={loading || !selectedUserId}
            className="w-full py-2.5 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-terracotta/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Calculating…" : "Calculate Paystub"}
          </button>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Right: Preview */}
        <div className="space-y-3">
          {!preview && !sent && (
            <div className="h-full min-h-48 flex items-center justify-center border border-dashed border-linen rounded-xl text-bark/30 text-sm">
              Select a VA and period, then click Calculate
            </div>
          )}

          {sent && (
            <div className="rounded-xl border border-sage/40 bg-sage-soft px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">✅</span>
                <div>
                  <div className="text-sm font-semibold text-bark">Paystub sent!</div>
                  {preview && (
                    <div className="text-xs text-bark/60">
                      Sent to {preview.vaEmail} · {formatCurrency(customAmount !== "" ? parseFloat(customAmount) : preview.grossPay)}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setPreview(null); setSent(false); setSelectedUserId(""); setPaymentWarning(null); }}
                className="text-xs text-terracotta underline underline-offset-2 shrink-0"
              >
                Send another
              </button>
            </div>
          )}

          {paymentWarning && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ {paymentWarning}
            </div>
          )}

          {preview && (
            <div className="rounded-xl border border-linen bg-white overflow-hidden">
              {/* Paystub preview header */}
              <div className="px-5 py-4 bg-parchment border-b border-linen flex items-center justify-between">
                <div>
                  <div className="text-xs text-bark/50 uppercase tracking-wide font-semibold">Paystub Preview</div>
                  <div className="text-sm font-bold text-bark mt-0.5">{preview.vaName}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-bark/50">Period</div>
                  <div className="text-xs font-semibold text-bark">{preview.payPeriod}</div>
                </div>
              </div>

              {/* Daily breakdown */}
              <div className="px-5 py-3">
                <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide mb-2">Hours Breakdown</div>
                {Object.keys(preview.byDate).length === 0 ? (
                  <p className="text-xs text-bark/40 italic py-2">No time logged for this period.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-bark/40 border-b border-linen">
                        <th className="text-left pb-1.5 font-semibold">Date</th>
                        <th className="text-right pb-1.5 font-semibold">Hours</th>
                        <th className="text-right pb-1.5 font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(preview.byDate)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([date, ms]) => (
                          <tr key={date} className="border-b border-linen/50">
                            <td className="py-1.5 text-bark/70">{formatDateLabel(date)}</td>
                            <td className="py-1.5 text-right text-bark/70">{formatHours(ms)}</td>
                            <td className="py-1.5 text-right text-bark/70">
                              {formatCurrency((ms / 3_600_000) * preview.payRate)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Fixed Assignments */}
              {preview.fixedAssignments && preview.fixedAssignments.length > 0 && (
                <div className="px-5 py-3 border-t border-linen">
                  <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide mb-2">Fixed Assignments</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-bark/40 border-b border-linen">
                        <th className="text-left pb-1.5 font-semibold">Task</th>
                        <th className="text-right pb-1.5 font-semibold">Rate</th>
                        <th className="text-right pb-1.5 font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.fixedAssignments.map((a) => (
                        <tr key={a.id} className="border-b border-linen/50">
                          <td className="py-1.5 text-bark/70">
                            {a.task_name}
                            {a.account && <span className="text-bark/40 ml-1">· {a.account}</span>}
                          </td>
                          <td className="py-1.5 text-right text-bark/70">
                            {a.quantity > 1 ? `${a.quantity}× ${formatCurrency(a.rate)}` : formatCurrency(a.rate)}
                          </td>
                          <td className="py-1.5 text-right text-bark/70">{formatCurrency(a.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              <div className="px-5 py-4 border-t border-linen bg-parchment">
                <div className="flex justify-between items-center text-xs text-bark/60 mb-1">
                  <span>Total Hours</span>
                  <span>{preview.totalHours.toFixed(2)} hrs</span>
                </div>
                <div className="flex justify-between items-center text-xs text-bark/60 mb-1">
                  <span>Rate</span>
                  <span>{formatCurrency(preview.payRate)}/hr</span>
                </div>
                <div className="flex justify-between items-center text-xs text-bark/60 mb-1">
                  <span>Hourly Pay</span>
                  <span>{formatCurrency(preview.grossPay)}</span>
                </div>
                {preview.fixedTotal > 0 && (
                  <div className="flex justify-between items-center text-xs text-bark/60 mb-1">
                    <span>Fixed Assignments</span>
                    <span>+ {formatCurrency(preview.fixedTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-semibold text-bark border-t border-linen pt-2 mt-1">
                  <span className="text-sm">Gross Pay</span>
                  <span className="text-sm">{formatCurrency(preview.totalGrossPay ?? preview.grossPay)}</span>
                </div>
                {preview.previousTotal > 0 && (
                  <div className="flex justify-between items-center text-xs text-bark/50 mt-1">
                    <span>Previous Payments</span>
                    <span>− {formatCurrency(preview.previousTotal)}</span>
                  </div>
                )}
                <div className="text-xs text-bark/40 mt-1">To: {preview.vaEmail}</div>
              </div>

              {/* Previous Payments */}
              {preview.previousPayments.length > 0 && (
                <div className="px-5 py-3 border-t border-linen bg-amber-50/40">
                  <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide mb-2">Previous Payments This Period</div>
                  <div className="space-y-1">
                    {preview.previousPayments.map((p) => (
                      <div key={p.id} className="flex justify-between items-center text-xs text-bark/70">
                        <span>
                          {new Date(p.payment_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                          {" · "}
                          <span className="capitalize">{p.payment_method.replace(/_/g, " ")}</span>
                          {p.notes ? <span className="text-bark/40"> · {p.notes}</span> : null}
                        </span>
                        <span className="font-semibold text-bark/80">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Editable Payment Amount */}
              <div className="px-5 py-4 border-t border-linen">
                <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                  Amount to Pay
                  {preview.previousTotal > 0 && (
                    <span className="normal-case font-normal text-bark/40 ml-1">(adjusted for previous payments)</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-bark/50">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="flex-1 border border-linen rounded-lg px-3 py-2 text-sm font-semibold text-terracotta bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                </div>
                {customAmount !== "" && parseFloat(customAmount) !== (preview.totalGrossPay ?? preview.grossPay) && (
                  <p className="text-xs text-bark/40 mt-1">
                    Default: {formatCurrency(preview.totalGrossPay ?? preview.grossPay)} · You entered: {formatCurrency(parseFloat(customAmount) || 0)}
                  </p>
                )}
              </div>

              {/* Miscellaneous Amount */}
              <div className="px-5 pb-4">
                <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                  Miscellaneous <span className="normal-case font-normal text-bark/40">(optional add-on)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-bark/50">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={miscAmount}
                    onChange={(e) => setMiscAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 border border-linen rounded-lg px-3 py-2 text-sm font-semibold text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  />
                </div>
                {miscAmount !== "" && parseFloat(miscAmount) > 0 && (
                  <div className="mt-2 flex justify-between items-center rounded-lg bg-parchment border border-linen px-3 py-2 text-xs font-semibold text-bark">
                    <span>Total to Send</span>
                    <span className="text-terracotta">
                      {formatCurrency((customAmount !== "" ? parseFloat(customAmount) : (preview.totalGrossPay ?? preview.grossPay)) + (parseFloat(miscAmount) || 0))}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Details */}
              <div className="px-5 py-4 border-t border-linen space-y-3">
                <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide">Payment Details</div>
                <div>
                  <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                  >
                    <option value="gcash">Gcash</option>
                    <option value="bank_deposit">Bank Deposit</option>
                    <option value="paypal">Paypal</option>
                    <option value="remittance">Remittance</option>
                  </select>
                </div>
                {/* Show stored account details for the selected method */}
                {(() => {
                  const accts = preview.paymentAccounts ?? {};
                  const details = accts[paymentMethod];
                  if (!details || !Object.values(details).some(Boolean)) {
                    return (
                      <p className="text-[11px] text-bark/40 italic">
                        No account details saved for this method. Go to Team → expand VA → Payment Accounts → Edit.
                      </p>
                    );
                  }
                  return (
                    <div className="rounded-lg bg-parchment border border-linen px-3 py-2 text-xs text-bark/70 space-y-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-bark/40 mb-1">Sending to</div>
                      {Object.entries(details).filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="capitalize text-bark/50">{k.replace(/_/g, " ")}:</span>
                          <span className="font-medium text-bark">{v}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                      Confirmation #
                    </label>
                    <input
                      type="text"
                      value={confirmationNumber}
                      onChange={(e) => setConfirmationNumber(e.target.value)}
                      placeholder="e.g. TXN123456"
                      className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                      Payment Date
                    </label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                    />
                  </div>
                </div>
              </div>

              {/* Personal Message */}
              <div className="px-5 py-4 border-t border-linen">
                <label className="block text-xs font-semibold text-bark/60 uppercase tracking-wide mb-1.5">
                  Personal Message <span className="normal-case font-normal text-bark/40">(optional)</span>
                </label>
                <textarea
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                  placeholder="e.g. Great work this pay period! Thank you for your hard work."
                  rows={3}
                  className="w-full border border-linen rounded-lg px-3 py-2 text-sm text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30 resize-none"
                />
              </div>

              {/* Send button */}
              <div className="px-5 py-4 border-t border-linen">
                {sent ? (
                  <div className="w-full py-2.5 rounded-lg bg-sage-soft border border-sage/40 text-center text-sm font-semibold text-bark/60">
                    ✓ Paystub Sent
                  </div>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="w-full py-2.5 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-terracotta/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {sending ? "Sending…" : `Send Paystub to ${preview.vaName}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Paystub History */}
      {selectedUserId && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-bark">Paystub History</h3>
              <p className="text-xs text-bark/50 mt-0.5">All sent paystubs for this VA — click any row to view the daily breakdown.</p>
            </div>
            {historyLoading && (
              <span className="text-xs text-bark/40 animate-pulse">Loading…</span>
            )}
          </div>

          {!historyLoading && history.length === 0 && (
            <div className="border border-dashed border-linen rounded-xl py-8 text-center text-sm text-bark/30">
              No paystubs sent yet for this VA.
            </div>
          )}

          {history.length > 0 && (
            <div className="border border-linen rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-parchment border-b border-linen text-xs text-bark/50 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-semibold">Pay Period</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Hours</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Gross Pay</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Amount Paid</th>
                    <th className="text-right px-4 py-2.5 font-semibold hidden sm:table-cell">Method</th>
                    <th className="text-right px-4 py-2.5 font-semibold hidden md:table-cell">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((snap) => {
                    const isExpanded = expandedId === snap.id;
                    const totalHrs = snap.total_hours_ms / 3_600_000;
                    return (
                      <React.Fragment key={snap.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : snap.id)}
                          className="border-b border-linen/70 hover:bg-parchment/50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 text-bark font-medium">
                            <div className="flex items-center gap-2">
                              <span className={`transition-transform text-bark/30 text-xs ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                              {snap.pay_period_label}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-bark/70">{totalHrs.toFixed(2)} hrs</td>
                          <td className="px-4 py-3 text-right text-bark/70">{formatCurrency(snap.gross_pay)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-terracotta">{formatCurrency(snap.amount_paid)}</td>
                          <td className="px-4 py-3 text-right text-bark/50 hidden sm:table-cell capitalize">
                            {snap.payment_method ? snap.payment_method.replace(/_/g, " ") : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-bark/40 text-xs hidden md:table-cell">
                            {new Date(snap.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="border-b border-linen bg-parchment/30">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Daily breakdown */}
                                <div>
                                  <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide mb-2">Daily Breakdown</div>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-bark/40 border-b border-linen">
                                        <th className="text-left pb-1 font-semibold">Date</th>
                                        <th className="text-right pb-1 font-semibold">Hours</th>
                                        <th className="text-right pb-1 font-semibold">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {Object.entries(snap.by_date)
                                        .sort(([a], [b]) => a.localeCompare(b))
                                        .map(([date, ms]) => (
                                          <tr key={date} className="border-b border-linen/40">
                                            <td className="py-1 text-bark/70">{formatDateLabel(date)}</td>
                                            <td className="py-1 text-right text-bark/70">{(ms / 3_600_000).toFixed(2)} hrs</td>
                                            <td className="py-1 text-right text-bark/70">{formatCurrency((ms / 3_600_000) * snap.pay_rate)}</td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>

                                {/* Payment details */}
                                <div className="space-y-2">
                                  <div className="text-xs font-semibold text-bark/50 uppercase tracking-wide mb-2">Payment Details</div>
                                  <div className="space-y-1 text-xs text-bark/70">
                                    <div className="flex justify-between">
                                      <span className="text-bark/40">Rate</span>
                                      <span>{formatCurrency(snap.pay_rate)}/hr</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-bark/40">Total Hours</span>
                                      <span>{totalHrs.toFixed(2)} hrs</span>
                                    </div>
                                    <div className="flex justify-between font-semibold border-t border-linen pt-1 mt-1">
                                      <span>Gross Pay</span>
                                      <span>{formatCurrency(snap.gross_pay)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold text-terracotta border-t border-linen pt-1 mt-1">
                                      <span>Amount Paid</span>
                                      <span>{formatCurrency(snap.amount_paid)}</span>
                                    </div>
                                    <div className="flex justify-between pt-1">
                                      <span className="text-bark/40">Sent to</span>
                                      <span>{snap.email_sent_to}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-bark/40">Sent at</span>
                                      <span>{new Date(snap.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} {new Date(snap.sent_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                                    </div>
                                  </div>

                                  {/* Payment details — read-only or editable */}
                                  <div className="pt-3 mt-2 border-t border-linen space-y-2">
                                    {editingSnapId === snap.id ? (
                                      <>
                                        <div>
                                          <label className="block text-[10px] font-semibold text-bark/40 uppercase tracking-wide mb-1">Payment Method</label>
                                          <select
                                            value={getEditValues(snap).payment_method}
                                            onChange={(e) =>
                                              setEditInputs((prev) => ({
                                                ...prev,
                                                [snap.id]: { ...getEditValues(snap), payment_method: e.target.value },
                                              }))
                                            }
                                            className="w-full border border-linen rounded-lg px-2 py-1.5 text-xs text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                                          >
                                            <option value="gcash">Gcash</option>
                                            <option value="bank_transfer">Bank Transfer</option>
                                            <option value="paypal">Paypal</option>
                                            <option value="check">Check</option>
                                            <option value="zelle">Zelle</option>
                                            <option value="venmo">Venmo</option>
                                            <option value="cash">Cash</option>
                                            <option value="other">Other</option>
                                          </select>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="block text-[10px] font-semibold text-bark/40 uppercase tracking-wide mb-1">Confirmation #</label>
                                            <input
                                              type="text"
                                              value={getEditValues(snap).confirmation_number}
                                              onChange={(e) =>
                                                setEditInputs((prev) => ({
                                                  ...prev,
                                                  [snap.id]: { ...getEditValues(snap), confirmation_number: e.target.value },
                                                }))
                                              }
                                              className="w-full border border-linen rounded-lg px-2 py-1.5 text-xs text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-semibold text-bark/40 uppercase tracking-wide mb-1">Payment Date</label>
                                            <input
                                              type="date"
                                              value={getEditValues(snap).payment_date}
                                              onChange={(e) =>
                                                setEditInputs((prev) => ({
                                                  ...prev,
                                                  [snap.id]: { ...getEditValues(snap), payment_date: e.target.value },
                                                }))
                                              }
                                              className="w-full border border-linen rounded-lg px-2 py-1.5 text-xs text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30"
                                            />
                                          </div>
                                        </div>
                                        <div>
                                          <label className="block text-[10px] font-semibold text-bark/40 uppercase tracking-wide mb-1">Note</label>
                                          <textarea
                                            value={getEditValues(snap).personal_message}
                                            onChange={(e) =>
                                              setEditInputs((prev) => ({
                                                ...prev,
                                                [snap.id]: { ...getEditValues(snap), personal_message: e.target.value },
                                              }))
                                            }
                                            rows={2}
                                            className="w-full border border-linen rounded-lg px-2 py-1.5 text-xs text-bark bg-white focus:outline-none focus:ring-2 focus:ring-terracotta/30 resize-none"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2 pt-1">
                                          <button
                                            onClick={() => handleSaveEdit(snap)}
                                            disabled={savingEditId === snap.id}
                                            className="px-3 py-1.5 rounded-lg bg-terracotta text-white text-xs font-semibold hover:bg-terracotta/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                          >
                                            {savingEditId === snap.id ? "Saving…" : "Save"}
                                          </button>
                                          <button
                                            onClick={() => setEditingSnapId(null)}
                                            disabled={savingEditId === snap.id}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                                          >
                                            Cancel
                                          </button>
                                          {savedEditId === snap.id && (
                                            <span className="text-xs text-green-600 font-medium">✓ Saved</span>
                                          )}
                                        </div>
                                      </>
                                    ) : (
                                      <div className="space-y-1.5">
                                        <div className="flex justify-between text-xs">
                                          <span className="text-bark/50">Payment Method</span>
                                          <span className="text-bark capitalize">{snap.payment_method?.replace(/_/g, " ") || "—"}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                          <span className="text-bark/50">Confirmation #</span>
                                          <span className="text-bark">{snap.confirmation_number || "—"}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                          <span className="text-bark/50">Payment Date</span>
                                          <span className="text-bark">{snap.payment_date ? new Date(snap.payment_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"}</span>
                                        </div>
                                        {snap.personal_message && (
                                          <div className="flex justify-between text-xs">
                                            <span className="text-bark/50">Note</span>
                                            <span className="text-bark text-right max-w-[60%]">{snap.personal_message}</span>
                                          </div>
                                        )}
                                        <div className="pt-1">
                                          <button
                                            onClick={() => setEditingSnapId(snap.id)}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
                                          >
                                            Edit
                                          </button>
                                          {savedEditId === snap.id && (
                                            <span className="ml-2 text-xs text-green-600 font-medium">✓ Saved</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Action buttons */}
                              <div className="mt-4 pt-4 border-t border-linen flex flex-wrap items-center gap-3">
                                {resendSuccessId === snap.id ? (
                                  <span className="text-xs text-sage-600 font-semibold text-green-700">✓ Resent to {snap.email_sent_to}</span>
                                ) : (
                                  <button
                                    onClick={() => handleResend(snap)}
                                    disabled={resendingId === snap.id}
                                    className="px-3 py-1.5 rounded-lg border border-linen bg-white text-xs font-semibold text-bark hover:bg-parchment disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {resendingId === snap.id ? "Resending…" : "↩ Resend Email"}
                                  </button>
                                )}
                                <a
                                  href={`/api/paystub/print?id=${snap.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 rounded-lg border border-linen bg-white text-xs font-semibold text-bark hover:bg-parchment transition-colors"
                                >
                                  ↓ Download PDF
                                </a>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
