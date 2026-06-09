"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

/* ── Types ───────────────────────────────────────────────── */

interface InvoiceData {
  id: number;
  invoice_number: string;
  to_name: string;
  to_email: string | null;
  total: number;
  currency: string;
  status: string;
  amount_paid: number;
  balance_due: number;
  allow_custom_amount: boolean;
  show_all_installments: boolean;
  payment_schedule: Array<{
    label: string;
    amount_type: "percentage" | "fixed";
    value: number;
  }> | null;
}

interface PaymentRecord {
  id: number;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  square_receipt_url: string | null;
}

interface SquareConfig {
  applicationId: string;
  locationId: string;
  environment: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Square?: any;
  }
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function computeInstallmentAmount(item: { amount_type: "percentage" | "fixed"; value: number }, total: number): number {
  if (item.amount_type === "percentage") {
    return Math.round((item.value / 100) * total * 100) / 100;
  }
  return item.value;
}

/* ── Component ───────────────────────────────────────────── */

export default function InvoicePayPage() {
  const params = useParams();
  const token = params?.token as string;

  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [squareConfig, setSquareConfig] = useState<SquareConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payment form state
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState<{ receiptUrl: string | null; amount: number; balanceRemaining: number } | null>(null);

  const [squareLoaded, setSquareLoaded] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentsRef = useRef<any>(null);

  /* ── Load invoice data ─────────────────────────────────── */

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invoices/pay/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setInvoice(data.invoice);
          setPayments(data.payments ?? []);
          setSquareConfig(data.square ?? null);

          // Pre-select first installment if schedule exists and custom is not allowed
          if (data.invoice?.payment_schedule?.length > 0) {
            const first = data.invoice.payment_schedule[0];
            const firstAmount = computeInstallmentAmount(first, data.invoice.total);
            setSelectedAmount(firstAmount);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load invoice.");
        setLoading(false);
      });
  }, [token]);

  /* ── Initialize Square Web Payments SDK ───────────────── */

  const initSquare = useCallback(async () => {
    if (!squareConfig || !window.Square || !cardRef.current || cardInstanceRef.current) return;

    try {
      const squarePayments = window.Square.payments(squareConfig.applicationId, squareConfig.locationId);
      paymentsRef.current = squarePayments;

      const card = await squarePayments.card({
        style: {
          ".input-container": { borderColor: "#e8e0d4", borderRadius: "8px" },
          ".input-container.is-focus": { borderColor: "#c0704e" },
          ".input-container.is-error": { borderColor: "#dc2626" },
          input: { color: "#3d2b1f", fontSize: "14px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
          "input::placeholder": { color: "#9e9080" },
        },
      });
      await card.attach(cardRef.current);
      cardInstanceRef.current = card;
      setCardReady(true);
    } catch (err) {
      console.error("Square SDK init error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setPaymentError(`Payment form error: ${errMsg}`);
    }
  }, [squareConfig]);

  /* ── Load Square SDK manually when squareConfig is ready ── */

  useEffect(() => {
    if (!squareConfig) return;

    // If script already exists and Square is already defined, mark loaded
    if (document.getElementById("square-sdk")) {
      if (window.Square) setSquareLoaded(true);
      return;
    }

    const src =
      squareConfig.environment === "sandbox"
        ? "https://sandbox.web.squarecdn.com/v1/square.js"
        : "https://web.squarecdn.com/v1/square.js";

    const script = document.createElement("script");
    script.id = "square-sdk";
    script.src = src;
    script.onload = () => setSquareLoaded(true);
    script.onerror = () =>
      setPaymentError("Failed to load payment SDK. Please refresh and try again.");
    document.head.appendChild(script);
  }, [squareConfig]);

  useEffect(() => {
    if (squareLoaded && squareConfig) {
      initSquare();
    }
  }, [squareLoaded, squareConfig, initSquare]);

  /* ── Handle payment submission ─────────────────────────── */

  const handlePay = async () => {
    if (!invoice || !cardInstanceRef.current || !paymentsRef.current) return;

    const payAmount = invoice.allow_custom_amount && customAmount
      ? Number(customAmount)
      : selectedAmount;

    if (!payAmount || isNaN(payAmount) || payAmount <= 0) {
      setPaymentError("Please enter or select a valid payment amount.");
      return;
    }

    if (payAmount > invoice.balance_due + 0.01) {
      setPaymentError(`Amount cannot exceed the balance due of ${formatCurrency(invoice.balance_due, invoice.currency)}.`);
      return;
    }

    setProcessing(true);
    setPaymentError("");

    try {
      const result = await cardInstanceRef.current.tokenize();

      if (result.status !== "OK") {
        const errorMessages = result.errors?.map((e: { message: string }) => e.message).join(", ") || "Card tokenization failed.";
        setPaymentError(errorMessages);
        setProcessing(false);
        return;
      }

      const idempotencyKey = `${invoice.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const res = await fetch(`/api/invoices/pay/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: result.token,
          amount: payAmount,
          idempotencyKey,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setPaymentError(data.error || "Payment failed. Please try again.");
        setProcessing(false);
        return;
      }

      setPaymentSuccess({
        receiptUrl: data.receiptUrl,
        amount: data.amountPaid,
        balanceRemaining: data.balanceRemaining,
      });
    } catch {
      setPaymentError("An unexpected error occurred. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  /* ── Loading / Error states ──────────────────────────── */

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8]">
        <div className="text-[#6b5e52]">Loading…</div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8]">
        <div className="rounded-xl bg-white p-8 text-center shadow-sm max-w-sm w-full mx-4">
          <div className="text-[18px] font-bold text-[#3d2b1f] mb-2">Invoice Not Found</div>
          <div className="text-[13px] text-[#6b5e52]">{error || "This link may have expired."}</div>
        </div>
      </div>
    );
  }

  const isFullyPaid = invoice.status === "paid" || invoice.balance_due <= 0.01;
  const hasSchedule = invoice.payment_schedule && invoice.payment_schedule.length > 0;

  /* ── Payment success screen ──────────────────────────── */

  if (paymentSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8] py-8 px-4">
        <div className="rounded-xl bg-white shadow-sm max-w-md w-full mx-auto overflow-hidden">
          <div className="bg-[#2d6a4f] px-6 py-8 text-center">
            <div className="text-5xl mb-3">✓</div>
            <div className="text-[22px] font-extrabold text-white">Payment Received!</div>
            <div className="text-[15px] text-[#a8d5b5] mt-1">{formatCurrency(paymentSuccess.amount, invoice.currency)} paid</div>
          </div>
          <div className="px-6 py-6 text-center">
            <div className="text-[13px] text-[#6b5e52] mb-1">Invoice #{invoice.invoice_number}</div>
            <div className="text-[13px] text-[#3d2b1f] font-semibold mb-4">{invoice.to_name}</div>
            {paymentSuccess.balanceRemaining > 0.01 && (
              <div className="rounded-lg bg-[#fff8f5] border border-[#e8d0c0] px-4 py-3 mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a5040] mb-1">Remaining Balance</div>
                <div className="text-[20px] font-bold text-[#c0704e]">{formatCurrency(paymentSuccess.balanceRemaining, invoice.currency)}</div>
              </div>
            )}
            {paymentSuccess.balanceRemaining <= 0.01 && (
              <div className="rounded-lg bg-[#f0faf4] border border-[#a0d5b0] px-4 py-3 mb-4">
                <div className="text-[13px] font-semibold text-[#2d6a4f]">Invoice fully paid — thank you! 🎉</div>
              </div>
            )}
            {paymentSuccess.receiptUrl && (
              <a
                href={paymentSuccess.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-[#2d3a4a] text-white text-[13px] font-bold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
              >
                View Receipt →
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Main payment page ───────────────────────────────── */

  return (
    <>
      <div className="min-h-screen bg-[#f5f0e8] py-8 px-4 font-sans">
        <div className="max-w-lg mx-auto">

          {/* Header */}
          <div className="rounded-xl bg-[#f5c842] px-6 py-6 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a4000] mb-1">Invoice #{invoice.invoice_number}</div>
            <div className="text-[20px] font-extrabold text-[#2d1a00] mb-1">{invoice.to_name}</div>
            <div className="flex items-end justify-between gap-4 mt-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a4000]">Invoice Total</div>
                <div className="text-[16px] font-bold text-[#5a4000] line-through decoration-[#8a6a10]">{formatCurrency(invoice.total, invoice.currency)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a4000]">Balance Due</div>
                <div className="text-[28px] font-extrabold text-[#2d1a00]">{formatCurrency(invoice.balance_due, invoice.currency)}</div>
              </div>
            </div>
          </div>

          {/* Already paid */}
          {isFullyPaid ? (
            <div className="rounded-xl bg-white shadow-sm px-6 py-8 text-center">
              <div className="text-3xl mb-3">✓</div>
              <div className="text-[16px] font-bold text-[#2d6a4f] mb-1">Fully Paid</div>
              <div className="text-[13px] text-[#6b5e52]">This invoice has been paid in full. Thank you!</div>
            </div>
          ) : !squareConfig ? (
            <div className="rounded-xl bg-white shadow-sm px-6 py-8 text-center">
              <div className="text-[14px] font-semibold text-[#3d2b1f] mb-2">Online Payment Unavailable</div>
              <div className="text-[13px] text-[#6b5e52]">Online payment has not been configured yet. Please contact the sender for payment instructions.</div>
            </div>
          ) : (
            <div className="rounded-xl bg-white shadow-sm overflow-hidden">

              {/* Payment history */}
              {payments.length > 0 && (
                <div className="px-5 pt-5 pb-3 border-b border-[#e8e0d4]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b5e52] mb-2">Payment History</div>
                  <div className="space-y-1.5">
                    {payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-[12px]">
                        <span className="text-[#6b5e52]">{new Date(p.payment_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        <span className="font-semibold text-[#2d6a4f]">{formatCurrency(Number(p.amount), invoice.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-5 space-y-5">
                {/* Payment schedule / installments */}
                {hasSchedule && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#6b5e52] mb-2">
                      {invoice.show_all_installments ? "Payment Options" : "Amount Due Now"}
                    </div>
                    <div className="space-y-2">
                      {(invoice.show_all_installments ? invoice.payment_schedule! : invoice.payment_schedule!.slice(0, 1)).map((item, i) => {
                        const amt = computeInstallmentAmount(item, invoice.total);
                        const isSelected = !invoice.allow_custom_amount ? selectedAmount === amt : selectedAmount === amt;
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              setSelectedAmount(amt);
                              setCustomAmount("");
                            }}
                            className={`w-full flex items-center justify-between rounded-lg border-2 px-4 py-3 transition-colors cursor-pointer ${
                              isSelected
                                ? "border-[#c0704e] bg-[#fff8f5]"
                                : "border-[#e8e0d4] bg-[#faf6f0] hover:border-[#d4b8a0]"
                            }`}
                          >
                            <span className="text-[13px] font-semibold text-[#3d2b1f]">{item.label}</span>
                            <span className="text-[15px] font-bold text-[#c0704e]">{formatCurrency(amt, invoice.currency)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Custom amount input */}
                {invoice.allow_custom_amount && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[#6b5e52]">
                      {hasSchedule ? "Or enter a custom amount" : "Amount to Pay"}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[#9e9080]">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={invoice.balance_due}
                        value={customAmount}
                        onChange={(e) => {
                          setCustomAmount(e.target.value);
                          setSelectedAmount(null);
                        }}
                        placeholder={invoice.balance_due.toFixed(2)}
                        className="w-full rounded-lg border-2 border-[#e8e0d4] bg-[#faf6f0] pl-7 pr-4 py-3 text-[15px] font-semibold text-[#3d2b1f] outline-none transition-colors focus:border-[#c0704e] placeholder:text-[#b0a090]"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-[#9e9080]">Max: {formatCurrency(invoice.balance_due, invoice.currency)}</p>
                  </div>
                )}

                {/* Square card form */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#6b5e52] mb-2">Card Details</div>
                  <div ref={cardRef} className="min-h-[100px]" />
                  {!cardReady && (
                    <div className="text-[12px] text-[#9e9080] mt-2 text-center">Loading card form…</div>
                  )}
                </div>

                {/* Error message */}
                {paymentError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
                    {paymentError}
                  </div>
                )}

                {/* Pay button */}
                <button
                  onClick={handlePay}
                  disabled={processing || !cardReady || (!selectedAmount && !customAmount)}
                  className="w-full rounded-lg bg-[#c0704e] text-white text-[15px] font-bold py-4 hover:bg-[#a85a3c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {processing ? "Processing…" : `Pay ${formatCurrency(
                    customAmount ? Number(customAmount) : (selectedAmount ?? invoice.balance_due),
                    invoice.currency
                  )}`}
                </button>

                <p className="text-center text-[11px] text-[#9e9080]">
                  Payments are securely processed by Square. Your card details are never stored on our servers.
                </p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="py-6 text-center">
            <div className="text-[11px] text-[#9e9080]">Powered by MinuteFlow · Secured by Square</div>
          </div>

        </div>
      </div>
    </>
  );
}
