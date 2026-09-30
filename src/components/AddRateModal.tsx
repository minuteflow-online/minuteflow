"use client";

import { useState, useEffect, useCallback } from "react";
import type { PayRateHistory } from "@/types/database";
import { formatPayMoney, normalizePayCurrency, PAY_CURRENCIES, type PayCurrency } from "@/lib/payroll";

interface AddRateModalProps {
  userId: string;
  userName: string;
  currentRate: number;
  currentRateType: string;
  currentCurrency?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function todayInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHistoryDate(s: string | null): string {
  if (!s) return "Present";
  return new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AddRateModal({
  userId,
  userName,
  currentRate,
  currentRateType,
  currentCurrency,
  onClose,
  onSaved,
}: AddRateModalProps) {
  const [history, setHistory] = useState<PayRateHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rateAmount, setRateAmount] = useState("");
  const [rateType, setRateType] = useState(currentRateType || "hourly");
  const [effectiveDate, setEffectiveDate] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [currency, setCurrency] = useState<PayCurrency>(normalizePayCurrency(currentCurrency));
  const [currencySaving, setCurrencySaving] = useState(false);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/pay-rates?user_id=${userId}`);
      const data = await res.json();
      if (res.ok) setHistory(data.history || []);
    } catch {
      // leave history empty
    }
    setHistoryLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSave = async () => {
    setError("");
    const amount = parseFloat(rateAmount);
    if (isNaN(amount) || amount < 0) {
      setError("Enter a valid rate amount.");
      return;
    }
    if (!effectiveDate) {
      setError("Pick an effective start date.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/pay-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          rate_amount: amount,
          rate_type: rateType,
          effective_date: effectiveDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save new rate.");
      } else {
        onSaved();
        onClose();
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSaving(false);
  };

  // Currency is a standing setting on the VA, separate from adding a rate —
  // switching it saves straight away and doesn't touch rate history.
  const handleCurrencyChange = async (next: PayCurrency) => {
    if (next === currency || currencySaving) return;
    const previous = currency;
    setError("");
    setCurrency(next);
    setCurrencySaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, pay_currency: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCurrency(previous);
        setError(data.error || "Failed to save currency.");
      } else {
        onSaved();
      }
    } catch {
      setCurrency(previous);
      setError("Network error. Please try again.");
    }
    setCurrencySaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-sand bg-white shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-parchment px-5 py-4">
          <h2 className="text-sm font-bold text-espresso">Pay Rate — {userName}</h2>
          <button
            onClick={onClose}
            className="text-stone hover:text-espresso transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Current rate */}
          <div className="rounded-lg bg-parchment px-3 py-3 flex items-center justify-between">
            <span className="text-[11px] text-bark">Current Rate</span>
            <span className="text-xs font-bold text-espresso">
              {formatPayMoney(currentRate || 0, currency)} / {currentRateType || "hourly"}
            </span>
          </div>

          {/* Pay currency */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">Currency</p>
              <p className="text-[10px] text-stone">Shown on this VA&apos;s rate and paystubs. Amounts aren&apos;t converted.</p>
            </div>
            <div className="flex gap-1">
              {PAY_CURRENCIES.map((c) => (
                <button
                  key={c}
                  onClick={() => handleCurrencyChange(c)}
                  disabled={currencySaving}
                  className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                    currency === c ? "bg-sage text-white" : "bg-stone/10 text-stone hover:bg-stone/20"
                  }`}
                >
                  {c === "PHP" ? "₱ PHP" : "$ USD"}
                </button>
              ))}
            </div>
          </div>

          {/* Add New Rate form */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">
              Add New Rate
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-bark">Amount ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rateAmount}
                  onChange={(e) => setRateAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-bark">Type</label>
                <select
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value)}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                >
                  <option value="hourly">hourly</option>
                  <option value="daily">daily</option>
                  <option value="monthly">monthly</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-bark">Effective Date</label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full rounded-lg border border-sand px-2 py-1.5 text-xs text-espresso outline-none bg-white"
                />
              </div>
            </div>
            {error && <p className="text-[11px] text-terracotta">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-stone/10 text-stone hover:bg-stone/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 rounded-lg bg-sage text-white text-[11px] font-semibold hover:bg-sage/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save New Rate"}
              </button>
            </div>
          </div>

          {/* Rate history */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-walnut tracking-wide uppercase">
              Rate History
            </p>
            {historyLoading ? (
              <p className="text-[11px] text-stone">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-[11px] text-stone">No rate history yet.</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border border-sand bg-white"
                  >
                    <div>
                      <span className="text-[12px] font-semibold text-espresso">
                        {formatPayMoney(Number(h.rate_amount), currency)} / {h.rate_type}
                      </span>
                      <div className="text-[10px] text-stone">
                        {formatHistoryDate(h.effective_date)} — {formatHistoryDate(h.end_date)}
                      </div>
                    </div>
                    {h.end_date === null && (
                      <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-sage-soft text-sage border border-sage/20">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
