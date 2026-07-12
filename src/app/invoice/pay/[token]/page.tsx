"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

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
  ach_enabled: boolean;
  payment_schedule: Array<{
    label: string;
    amount_type: "percentage" | "fixed";
    value: number;
    due_date?: string;
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
  // selectedIndex: 0 = next installment, 1 = full payment
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(1);
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState<{ receiptUrl: string | null; amount: number; totalCharged?: number; balanceRemaining: number } | null>(null);

  const searchParams = useSearchParams();
  const [paymentMethodTab, setPaymentMethodTab] = useState<"card" | "ach">(
    searchParams?.get("method") === "ach" ? "ach" : "card"
  );

  const [squareLoaded, setSquareLoaded] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentsRef = useRef<any>(null);

  // ACH / bank transfer
  const achRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const achInstanceRef = useRef<any>(null);
  const [achReady, setAchReady] = useState(false);
  const [achError, setAchError] = useState(false);

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

          const inv = data.invoice as InvoiceData;

          // Find the next unpaid installment based on due date order + amount_paid
          if (inv.payment_schedule && inv.payment_schedule.length > 0) {
            const sorted = [...inv.payment_schedule].sort((a, b) => {
              if (!a.due_date && !b.due_date) return 0;
              if (!a.due_date) return 1;
              if (!b.due_date) return -1;
              return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            });
            let paidSoFar = inv.amount_paid;
            let foundNext = false;
            for (const item of sorted) {
              const amt = computeInstallmentAmount(item, inv.total);
              if (paidSoFar < amt - 0.01) {
                setSelectedAmount(amt);
                setSelectedIndex(0); // next installment
                foundNext = true;
                break;
              }
              paidSoFar -= amt;
            }
            if (!foundNext) {
              // All installments covered — default to full balance
              setSelectedAmount(inv.balance_due);
              setSelectedIndex(1);
            }
          } else {
            // No schedule — full payment only
            setSelectedAmount(inv.balance_due);
            setSelectedIndex(1);
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

    const CARD_STYLE = {
      ".input-container": { borderColor: "#e8e0d4", borderRadius: "8px" },
      ".input-container.is-focus": { borderColor: "#c0704e" },
      ".input-container.is-error": { borderColor: "#dc2626" },
      input: { color: "#3d2b1f", fontSize: "14px", fontFamily: "Arial, sans-serif" },
      "input::placeholder": { color: "#9e9080" },
    };

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 600; // ms

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const squarePayments = window.Square.payments(squareConfig.applicationId, squareConfig.locationId);
        paymentsRef.current = squarePayments;

        const card = await squarePayments.card({ style: CARD_STYLE });
        await card.attach(cardRef.current);
        cardInstanceRef.current = card;
        setCardReady(true);
        return; // success — stop retrying
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimingError = errMsg.toLowerCase().includes("initialized in time") || errMsg.toLowerCase().includes("not ready");
        console.warn(`Square SDK init attempt ${attempt + 1} failed:`, errMsg);

        if (isTimingError && attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
          continue; // retry
        }

        // Non-timing error or out of retries
        setPaymentError(`Payment form error: ${errMsg}`);
        return;
      }
    }
  }, [squareConfig]);

  /* ── Initialize Square ACH (bank transfer) ────────────── */

  const initAch = useCallback(async () => {
    if (!squareConfig || !paymentsRef.current || !achRef.current || achInstanceRef.current) return;

    try {
      const ach = await paymentsRef.current.ach({
        redirectURI: window.location.href.split("?")[0],
        transactionId: `ach-inv-${Date.now()}`,
      });
      await ach.attach(achRef.current);
      achInstanceRef.current = ach;
      setAchReady(true);
    } catch (err) {
      console.error("Square ACH init error:", err);
      setAchError(true);
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

  // ACH is initialized on-demand when the user switches to the Bank Transfer tab
  // (initializing while the section is hidden causes Plaid to fail silently)

  /* ── Handle payment submission ─────────────────────────── */

  const handlePay = async (method: "card" | "ach") => {
    if (!invoice || !paymentsRef.current) return;

    const payAmount = selectedAmount;

    if (!payAmount || isNaN(payAmount) || payAmount <= 0) {
      setPaymentError("Please select a payment option.");
      return;
    }

    if (payAmount > invoice.balance_due + 0.01) {
      setPaymentError(`Amount cannot exceed the balance due of ${formatCurrency(invoice.balance_due, invoice.currency)}.`);
      return;
    }

    if (method === "card" && !cardInstanceRef.current) return;
    if (method === "ach" && !achInstanceRef.current) return;

    // Fee: card = 3%, bank transfer = 1%
    const fee = method === "ach"
      ? Math.round(payAmount * 0.01 * 100) / 100
      : Math.round(payAmount * 0.03 * 100) / 100;

    setProcessing(true);
    setPaymentError("");

    try {
      const tokenResult = method === "ach"
        ? await achInstanceRef.current.tokenize({ accountHolderName: invoice.to_name || "Customer" })
        : await cardInstanceRef.current.tokenize();

      if (tokenResult.status !== "OK") {
        const errorMessages = tokenResult.errors?.map((e: { message: string }) => e.message).join(", ")
          || (method === "ach" ? "Bank transfer tokenization failed." : "Card tokenization failed.");
        setPaymentError(errorMessages);
        setProcessing(false);
        return;
      }

      const idempotencyKey = `${invoice.id}-${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const res = await fetch(`/api/invoices/pay/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: tokenResult.token,
          amount: payAmount,
          processingFee: fee,
          paymentMethodLabel: method === "ach" ? "Bank Transfer (ACH)" : "Square Card",
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
        totalCharged: data.totalCharged,
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

  // Compute next unpaid installment (sorted by due date, skip fully-covered ones)
  const sortedSchedule = invoice.payment_schedule
    ? [...invoice.payment_schedule].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      })
    : [];

  let nextInstallment: (typeof sortedSchedule)[0] | null = null;
  let nextInstallmentAmount = 0;
  if (sortedSchedule.length > 0) {
    let paidSoFar = invoice.amount_paid;
    for (const item of sortedSchedule) {
      const amt = computeInstallmentAmount(item, invoice.total);
      if (paidSoFar < amt - 0.01) {
        nextInstallment = item;
        nextInstallmentAmount = amt;
        break;
      }
      paidSoFar -= amt;
    }
  }

  // Precompute paid / next / future status for each installment
  const installmentWithStatus = (() => {
    let paidRemaining = invoice.amount_paid;
    let nextFound = false;
    return sortedSchedule.map((item) => {
      const amt = computeInstallmentAmount(item, invoice.total);
      let status: "paid" | "next" | "future";
      if (!nextFound && paidRemaining >= amt - 0.01) {
        paidRemaining -= amt;
        status = "paid";
      } else if (!nextFound) {
        nextFound = true;
        status = "next";
      } else {
        status = "future";
      }
      return { item, amt, status };
    });
  })();

  // Processing fees
  const basePayAmount = selectedAmount ?? 0;
  const cardFee = basePayAmount > 0 ? Math.round(basePayAmount * 0.03 * 100) / 100 : 0;
  const cardTotalCharged = basePayAmount > 0 ? Math.round((basePayAmount + cardFee) * 100) / 100 : 0;
  const achFee = basePayAmount > 0 ? Math.round(basePayAmount * 0.01 * 100) / 100 : 0;
  const achTotalCharged = basePayAmount > 0 ? Math.round((basePayAmount + achFee) * 100) / 100 : 0;

  /* ── Payment success screen ──────────────────────────── */

  if (paymentSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8] py-8 px-4">
        <div className="rounded-xl bg-white shadow-sm max-w-md w-full mx-auto overflow-hidden">
          <div className="bg-[#2d6a4f] px-6 py-8 text-center">
            <div className="text-5xl mb-3">✓</div>
            <div className="text-[22px] font-extrabold text-white">Payment Received!</div>
            <div className="text-[15px] text-[#a8d5b5] mt-1">{formatCurrency(paymentSuccess.totalCharged ?? paymentSuccess.amount, invoice.currency)} paid</div>
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
            <div className="mt-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a4000]">Invoice Balance Due</div>
              <div className="text-[28px] font-extrabold text-[#2d1a00]">{formatCurrency(invoice.balance_due, invoice.currency)}</div>
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

                {/* Payment options */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#6b5e52] mb-2">Payment Options</div>
                  <div className="space-y-2">

                    {/* All installments — paid are dimmed, next is clickable, future are disabled */}
                    {installmentWithStatus.map(({ item, amt, status }, idx) => {
                      if (status === "paid") {
                        return (
                          <div
                            key={idx}
                            className="w-full flex items-center justify-between rounded-lg border-2 border-[#e8e0d4] bg-[#f5f5f0] px-4 py-3 opacity-60 cursor-not-allowed"
                          >
                            <div className="text-left">
                              <span className="text-[13px] font-semibold text-[#9e9080] line-through">{item.label}</span>
                              {item.due_date && (
                                <div className="text-[10px] text-[#b0a090] mt-0.5">
                                  Due: {new Date(item.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-[#2d6a4f] bg-[#e8f5ee] px-1.5 py-0.5 rounded">Paid ✓</span>
                              <span className="text-[14px] font-bold text-[#9e9080]">{formatCurrency(amt, invoice.currency)}</span>
                            </div>
                          </div>
                        );
                      }

                      if (status === "next") {
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedAmount(amt);
                              setSelectedIndex(0);
                            }}
                            className={`w-full flex items-center justify-between rounded-lg border-2 px-4 py-3 transition-colors cursor-pointer ${
                              selectedIndex === 0
                                ? "border-[#c0704e] bg-[#fff8f5]"
                                : "border-[#e8e0d4] bg-[#faf6f0] hover:border-[#d4b8a0]"
                            }`}
                          >
                            <div className="text-left">
                              <span className="text-[13px] font-semibold text-[#3d2b1f]">{item.label}</span>
                              {item.due_date && (
                                <div className="text-[10px] text-[#9e9080] mt-0.5">
                                  Due: {new Date(item.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                              )}
                            </div>
                            <span className="text-[15px] font-bold text-[#2d6a4f]">{formatCurrency(amt, invoice.currency)}</span>
                          </button>
                        );
                      }

                      // Future — visible but disabled
                      return (
                        <div
                          key={idx}
                          className="w-full flex items-center justify-between rounded-lg border-2 border-[#e8e0d4] bg-[#f5f5f0] px-4 py-3 opacity-40 cursor-not-allowed select-none"
                        >
                          <div className="text-left">
                            <span className="text-[13px] font-semibold text-[#6b5e52]">{item.label}</span>
                            {item.due_date && (
                              <div className="text-[10px] text-[#9e9080] mt-0.5">
                                Due: {new Date(item.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </div>
                            )}
                          </div>
                          <span className="text-[14px] font-bold text-[#9e9080]">{formatCurrency(amt, invoice.currency)}</span>
                        </div>
                      );
                    })}

                    {/* Full Payment — always shown */}
                    <button
                      onClick={() => {
                        setSelectedAmount(invoice.balance_due);
                        setSelectedIndex(1);
                      }}
                      className={`w-full flex items-center justify-between rounded-lg border-2 px-4 py-3 transition-colors cursor-pointer ${
                        selectedIndex === 1
                          ? "border-[#c0704e] bg-[#fff8f5]"
                          : "border-[#e8e0d4] bg-[#faf6f0] hover:border-[#d4b8a0]"
                      }`}
                    >
                      <div className="text-left">
                        <span className="text-[13px] font-semibold text-[#3d2b1f]">Full Payment</span>
                        <div className="text-[10px] text-[#9e9080] mt-0.5">Pay remaining balance in full</div>
                      </div>
                      <span className="text-[15px] font-bold text-[#2d6a4f]">{formatCurrency(invoice.balance_due, invoice.currency)}</span>
                    </button>

                  </div>
                </div>

                {/* Error message */}
                {paymentError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
                    {paymentError}
                  </div>
                )}

                {/* Payment method tabs — show Bank Transfer tab only when ach_enabled */}
                {invoice.ach_enabled && (
                  <div className="flex rounded-lg border border-[#e8e0d4] overflow-hidden">
                    <button
                      onClick={() => setPaymentMethodTab("card")}
                      className={`flex-1 py-2.5 text-[12px] font-semibold transition-colors ${
                        paymentMethodTab === "card"
                          ? "bg-[#2d6a4f] text-white"
                          : "bg-white text-[#6b5e52] hover:bg-[#faf6f0]"
                      }`}
                    >
                      💳 Pay with Card
                    </button>
                    <button
                      onClick={() => {
                        setPaymentMethodTab("ach");
                        // Initialize ACH on first click — must be visible in DOM for Plaid to attach
                        if (!achInstanceRef.current && paymentsRef.current) {
                          initAch();
                        }
                      }}
                      className={`flex-1 py-2.5 text-[12px] font-semibold transition-colors border-l border-[#e8e0d4] ${
                        paymentMethodTab === "ach"
                          ? "bg-[#2d6a4f] text-white"
                          : "bg-white text-[#6b5e52] hover:bg-[#faf6f0]"
                      }`}
                    >
                      🏦 Bank Transfer
                    </button>
                  </div>
                )}

                {/* Card section */}
                <div className={paymentMethodTab === "card" ? "" : "hidden"}>
                  {!invoice.ach_enabled && (
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#6b5e52] mb-2">💳 Credit / Debit Card</div>
                  )}
                  <div ref={cardRef} className="min-h-[100px]" />
                  {!cardReady && (
                    <div className="text-[12px] text-[#9e9080] mt-2 text-center">Loading card form…</div>
                  )}
                  {basePayAmount > 0 && (
                    <div className="rounded-lg bg-[#faf6f0] border border-[#e8e0d4] px-4 py-3 space-y-1.5 mt-3">
                      <div className="flex justify-between text-[12px] text-[#6b5e52]">
                        <span>Amount</span>
                        <span>{formatCurrency(basePayAmount, invoice.currency)}</span>
                      </div>
                      <div className="flex justify-between text-[12px] text-[#6b5e52]">
                        <span>Card processing fee (3%)</span>
                        <span>{formatCurrency(cardFee, invoice.currency)}</span>
                      </div>
                      <div className="flex justify-between text-[13px] font-bold text-[#3d2b1f] border-t border-[#e8e0d4] pt-1.5">
                        <span>Total charged</span>
                        <span>{formatCurrency(cardTotalCharged, invoice.currency)}</span>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => handlePay("card")}
                    disabled={processing || !cardReady || !selectedAmount}
                    className="w-full mt-3 rounded-lg bg-[#2d6a4f] text-white text-[15px] font-bold py-4 hover:bg-[#1f4d38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {processing && paymentMethodTab === "card"
                      ? "Processing…"
                      : !cardReady
                      ? "Loading payment form…"
                      : `Pay ${formatCurrency(cardTotalCharged, invoice.currency)} with Card`}
                  </button>
                  <p className="text-center text-[11px] text-[#9e9080] mt-2">
                    Payments are securely processed by Square. Your card details are never stored on our servers.
                  </p>
                </div>

                {/* Bank Transfer (ACH) section */}
                {invoice.ach_enabled && (
                  <div className={paymentMethodTab === "ach" ? "" : "hidden"}>
                    <div ref={achRef} className="min-h-[60px]" />
                    {!achReady && !achError && (
                      <div className="text-[12px] text-[#9e9080] mt-2 text-center">Loading bank transfer form…</div>
                    )}
                    {achError && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 mt-2 text-center">
                        Bank transfer is unavailable at this time. Please use Pay with Card instead.
                      </div>
                    )}
                    {basePayAmount > 0 && achReady && (
                      <div className="rounded-lg bg-[#faf6f0] border border-[#e8e0d4] px-4 py-3 space-y-1.5 mt-3">
                        <div className="flex justify-between text-[12px] text-[#6b5e52]">
                          <span>Amount</span>
                          <span>{formatCurrency(basePayAmount, invoice.currency)}</span>
                        </div>
                        <div className="flex justify-between text-[12px] text-[#6b5e52]">
                          <span>Bank transfer fee (1%)</span>
                          <span>{formatCurrency(achFee, invoice.currency)}</span>
                        </div>
                        <div className="flex justify-between text-[13px] font-bold text-[#3d2b1f] border-t border-[#e8e0d4] pt-1.5">
                          <span>Total charged</span>
                          <span>{formatCurrency(achTotalCharged, invoice.currency)}</span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => handlePay("ach")}
                      disabled={processing || !achReady || !selectedAmount}
                      className="w-full mt-3 rounded-lg bg-[#2d6a4f] text-white text-[15px] font-bold py-4 hover:bg-[#1f4d38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {processing && paymentMethodTab === "ach"
                        ? "Processing…"
                        : !achReady
                        ? "Loading…"
                        : `Pay ${formatCurrency(achTotalCharged, invoice.currency)} with Bank Transfer`}
                    </button>
                    <p className="text-center text-[11px] text-[#9e9080] mt-2">
                      Bank transfers are secure and have a lower 1% processing fee. Powered by Square + Plaid.
                    </p>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* View full invoice details */}
          <div className="mt-2 mb-2 text-center">
            <a
              href={`/invoice/view/${token}`}
              className="inline-block text-[12px] font-semibold text-[#5a4000] underline underline-offset-2 hover:text-[#2d1a00] transition-colors"
            >
              View Full Invoice Details →
            </a>
          </div>

          {/* Footer */}
          <div className="py-6 text-center">
            <div className="text-[11px] text-[#9e9080]">Powered by MinuteFlow · Secured by Square</div>
          </div>

        </div>
      </div>
    </>
  );
}
