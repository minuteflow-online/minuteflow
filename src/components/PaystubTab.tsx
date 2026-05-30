"use client";

import React, { useState, useCallback } from "react";
import type { Profile } from "@/types/database";

interface Props {
  profiles: Profile[];
  orgTimezone: string;
}

type PeriodPreset = "this_week" | "last_week" | "this_biweek" | "last_biweek" | "this_month" | "last_month" | "custom";

interface PreviewData {
  vaName: string;
  vaEmail: string;
  payPeriod: string;
  totalHours: number;
  payRate: number;
  grossPay: number;
  byDate: Record<string, number>;
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

  if (preset === "this_biweek") {
    // 1st–15th or 16th–end of month
    const day = local.getDate();
    const yr = local.getFullYear();
    const mo = local.getMonth();
    if (day <= 15) {
      const start = dateToIso(new Date(yr, mo, 1));
      const end = dateToIso(new Date(yr, mo, 15));
      return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
    } else {
      const start = dateToIso(new Date(yr, mo, 16));
      const end = dateToIso(new Date(yr, mo + 1, 0)); // last day of month
      return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
    }
  }

  if (preset === "last_biweek") {
    const day = local.getDate();
    const yr = local.getFullYear();
    const mo = local.getMonth();
    if (day <= 15) {
      // previous month's second half
      const start = dateToIso(new Date(yr, mo - 1, 16));
      const end = dateToIso(new Date(yr, mo, 0));
      return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
    } else {
      // this month's first half
      const start = dateToIso(new Date(yr, mo, 1));
      const end = dateToIso(new Date(yr, mo, 15));
      return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
    }
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

export default function PaystubTab({ profiles, orgTimezone }: Props) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [preset, setPreset] = useState<PeriodPreset>("last_biweek");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [selectedUserId, preset, customStart, customEnd, orgTimezone]);

  const handleSend = useCallback(async () => {
    if (!preview) return;
    setError(null);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send.");
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }, [preview, selectedUserId, preset, customStart, customEnd, orgTimezone]);

  const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
    { value: "this_week", label: "This Week (Mon–Sun)" },
    { value: "last_week", label: "Last Week (Mon–Sun)" },
    { value: "this_biweek", label: "This Half-Month (1–15 or 16–end)" },
    { value: "last_biweek", label: "Last Half-Month" },
    { value: "this_month", label: "This Month" },
    { value: "last_month", label: "Last Month" },
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
        <div>
          {!preview && !sent && (
            <div className="h-full min-h-48 flex items-center justify-center border border-dashed border-linen rounded-xl text-bark/30 text-sm">
              Select a VA and period, then click Calculate
            </div>
          )}

          {sent && (
            <div className="rounded-xl border border-sage/40 bg-sage-soft p-6 text-center space-y-2">
              <div className="text-3xl">✅</div>
              <div className="text-sm font-semibold text-bark">Paystub sent!</div>
              {preview && (
                <div className="text-xs text-bark/60">
                  Sent to {preview.vaEmail} · {formatCurrency(preview.grossPay)} for {preview.totalHours.toFixed(2)} hrs
                </div>
              )}
              <button
                onClick={() => { setPreview(null); setSent(false); setSelectedUserId(""); }}
                className="mt-3 text-xs text-terracotta underline underline-offset-2"
              >
                Send another
              </button>
            </div>
          )}

          {preview && !sent && (
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

              {/* Totals */}
              <div className="px-5 py-4 border-t border-linen bg-parchment">
                <div className="flex justify-between items-center text-xs text-bark/60 mb-1">
                  <span>Total Hours</span>
                  <span>{preview.totalHours.toFixed(2)} hrs</span>
                </div>
                <div className="flex justify-between items-center text-xs text-bark/60 mb-2">
                  <span>Rate</span>
                  <span>{formatCurrency(preview.payRate)}/hr</span>
                </div>
                <div className="flex justify-between items-center font-bold text-bark border-t border-linen pt-2">
                  <span className="text-sm">Gross Pay</span>
                  <span className="text-terracotta text-base">{formatCurrency(preview.grossPay)}</span>
                </div>
                <div className="text-xs text-bark/40 mt-1">To: {preview.vaEmail}</div>
              </div>

              {/* Send button */}
              <div className="px-5 py-4 border-t border-linen">
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="w-full py-2.5 rounded-lg bg-terracotta text-white text-sm font-semibold hover:bg-terracotta/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? "Sending…" : `Send Paystub to ${preview.vaName}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
