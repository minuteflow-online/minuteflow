import { createClient as createServiceClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { sendResendEmail } from "@/lib/sendEmail";
import { buildReceiptEmail } from "@/lib/invoiceReceiptEmail";
import { syncInvoicePaymentState } from "@/lib/invoiceBalance";
import { isValidProcessingFee } from "@/lib/processingFee";

export const dynamic = "force-dynamic";

/** GET /api/invoices/pay/[token] — public, no auth — returns invoice + payment info for the payment page */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  if (!rawToken) return Response.json({ error: "Token required" }, { status: 400 });
  // Strip any non-UUID characters (e.g. trailing backtick from Telegram link formatting)
  const token = rawToken.replace(/[^0-9a-f-]/gi, "");

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: invoice, error } = await serviceClient
    .from("invoices")
    .select("id, invoice_number, to_name, to_email, total, previous_balance, currency, status, amount_paid, allow_custom_amount, show_all_installments, payment_schedule, ach_enabled")
    .eq("share_token", token)
    .single();

  if (error || !invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

  // Don't allow paying a trashed or already fully paid invoice
  if (invoice.status === "trash") return Response.json({ error: "Invoice not found" }, { status: 404 });

  // Fetch existing payments for this invoice
  const { data: payments } = await serviceClient
    .from("invoice_payments")
    .select("id, amount, payment_date, payment_method, square_receipt_url")
    .eq("invoice_id", invoice.id)
    .order("created_at", { ascending: true });

  // Fetch Square application_id (safe to expose — it's a public key)
  const { data: squareSettings } = await serviceClient
    .from("square_settings")
    .select("application_id, location_id, environment")
    .limit(1)
    .single();

  const amountPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const prevBalance = Number(invoice.previous_balance || 0);
  const balanceDue = Math.max(0, Number(invoice.total) + prevBalance - amountPaid);

  return Response.json({
    invoice: {
      ...invoice,
      amount_paid: amountPaid,
      balance_due: balanceDue,
    },
    payments: payments ?? [],
    square: squareSettings
      ? {
          applicationId: squareSettings.application_id,
          locationId: squareSettings.location_id,
          environment: squareSettings.environment,
        }
      : null,
  });
}

/** POST /api/invoices/pay/[token] — public, no auth — process a Square payment */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  if (!rawToken) return Response.json({ error: "Token required" }, { status: 400 });
  // Strip any non-UUID characters (e.g. trailing backtick from Telegram link formatting)
  const token = rawToken.replace(/[^0-9a-f-]/gi, "");

  const body = await request.json();
  const { sourceId, amount, processingFee, idempotencyKey, paymentMethodLabel } = body;

  if (!sourceId) return Response.json({ error: "sourceId (card nonce) is required" }, { status: 400 });
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return Response.json({ error: "Valid payment amount is required" }, { status: 400 });
  }
  if (!idempotencyKey) return Response.json({ error: "idempotencyKey is required" }, { status: 400 });

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Load invoice
  const { data: invoice, error: invError } = await serviceClient
    .from("invoices")
    .select("id, invoice_number, to_name, to_email, total, previous_balance, currency, status, amount_paid, allow_custom_amount, payment_schedule")
    .eq("share_token", token)
    .single();

  if (invError || !invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "trash") return Response.json({ error: "Invoice not found" }, { status: 404 });

  // Fetch existing payments to compute balance
  const { data: existingPayments } = await serviceClient
    .from("invoice_payments")
    .select("amount")
    .eq("invoice_id", invoice.id);

  const alreadyPaid = (existingPayments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const prevBalancePost = Number(invoice.previous_balance || 0);
  const grandTotal = Number(invoice.total) + prevBalancePost;
  const balanceDue = Math.max(0, grandTotal - alreadyPaid);

  if (balanceDue <= 0) {
    return Response.json({ error: "This invoice has already been paid in full" }, { status: 400 });
  }

  const payAmount = Number(amount);
  const fee = Number(processingFee) || 0;
  // The fee comes from the browser, so it has to be one the page could have
  // produced. Without this a negative fee charges less than the amount that
  // gets credited to the invoice.
  if (!isValidProcessingFee(payAmount, fee)) {
    return Response.json({ error: "Invalid processing fee" }, { status: 400 });
  }
  const chargeAmount = Math.round((payAmount + fee) * 100) / 100;

  // Validate base amount does not exceed balance (fee is on top, not counted against balance)
  if (payAmount > balanceDue + 0.01) {
    return Response.json({ error: `Amount exceeds balance due of $${balanceDue.toFixed(2)}` }, { status: 400 });
  }

  // If custom amount is disabled, validate against schedule
  if (!invoice.allow_custom_amount && invoice.payment_schedule) {
    const schedule = invoice.payment_schedule as Array<{ label: string; amount_type: string; value: number }>;
    const validAmounts = schedule.map((item) => {
      if (item.amount_type === "percentage") return Math.round((item.value / 100) * Number(invoice.total) * 100) / 100;
      return item.value;
    });
    const isValid = validAmounts.some((v) => Math.abs(v - payAmount) < 0.02);
    if (!isValid) {
      return Response.json({ error: "Invalid payment amount — must match one of the defined installments" }, { status: 400 });
    }
  }

  // Load Square credentials
  const { data: squareSettings } = await serviceClient
    .from("square_settings")
    .select("access_token, location_id, environment")
    .limit(1)
    .single();

  if (!squareSettings) {
    return Response.json({ error: "Payment processing is not configured" }, { status: 500 });
  }

  const squareBaseUrl = squareSettings.environment === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

  // Create Square payment
  const squareRes = await fetch(`${squareBaseUrl}/v2/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${squareSettings.access_token}`,
      "Square-Version": "2024-11-20",
    },
    body: JSON.stringify({
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: {
        amount: Math.round(chargeAmount * 100), // Square uses cents — includes base + 3% processing fee
        currency: invoice.currency || "USD",
      },
      location_id: squareSettings.location_id,
      note: `Invoice ${invoice.invoice_number} — ${invoice.to_name}`,
    }),
  });

  if (!squareRes.ok) {
    const squareError = await squareRes.json().catch(() => ({ errors: [] }));
    const errorMsg = squareError?.errors?.[0]?.detail || "Payment processing failed";
    return Response.json({ error: errorMsg }, { status: 400 });
  }

  const squareData = await squareRes.json();
  const squarePayment = squareData.payment;

  // Record payment in invoice_payments
  const { error: insertError } = await serviceClient
    .from("invoice_payments")
    .insert({
      invoice_id: invoice.id,
      amount: payAmount,
      payment_date: new Date().toISOString().split("T")[0],
      payment_method: paymentMethodLabel || "Square Card",
      reference_number: squarePayment?.id ?? null,
      notes: `Paid online via Square — Invoice ${invoice.invoice_number}`,
      square_payment_id: squarePayment?.id ?? null,
      square_receipt_url: squarePayment?.receipt_url ?? null,
    });

  if (insertError) {
    // Payment went through but we failed to record — log this
    console.error("CRITICAL: Square payment succeeded but invoice_payments insert failed", insertError);
    return Response.json({ error: "Payment processed but recording failed — contact support with reference: " + (squarePayment?.id ?? "unknown") }, { status: 500 });
  }

  // Update invoice status from the payment rows, including the one just
  // inserted — the same derivation the admin screens use.
  const synced = await syncInvoicePaymentState(serviceClient, invoice.id);
  const newAmountPaid = synced?.amount_paid ?? alreadyPaid + payAmount;
  const newStatus = synced?.status ?? (newAmountPaid >= grandTotal - 0.01 ? "paid" : "partially_paid");

  // Send receipt email to client (fire-and-forget)
  if (invoice.to_email && process.env.RESEND_API_KEY) {
    const receiptUrl = squarePayment?.receipt_url ?? null;
    const balanceRemaining = Math.max(0, grandTotal - newAmountPaid);
    const isPaid = newStatus === "paid";
    const receiptHtml = buildReceiptEmail({
      invoiceNumber: invoice.invoice_number,
      toName: invoice.to_name,
      amountPaid: payAmount,
      total: grandTotal,
      balanceRemaining,
      isPaid,
      receiptUrl,
      currency: invoice.currency || "USD",
    });
    // after() keeps the function alive until the send finishes. Started and
    // left, the send can be cut off once the reply goes out, so a customer
    // who was charged never got a receipt.
    const toEmail = invoice.to_email;
    const subject = `Payment Receipt — Invoice ${invoice.invoice_number}`;
    after(async () => {
      try {
        const res = await sendResendEmail({
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "MinuteFlow <noreply@minuteflow.click>",
            to: [toEmail],
            subject,
            html: receiptHtml,
          }),
        });
        if (!res.ok) console.error(`[pay] receipt email for ${invoice.invoice_number} was not sent (${res.status})`);
      } catch (err) {
        // Non-fatal — the payment is already recorded — but say so in the logs.
        console.error(`[pay] receipt email for ${invoice.invoice_number} failed`, err);
      }
    });
  }

  return Response.json({
    success: true,
    receiptUrl: squarePayment?.receipt_url ?? null,
    amountPaid: payAmount,
    totalCharged: chargeAmount,
    newStatus,
    balanceRemaining: Math.max(0, grandTotal - newAmountPaid),
  });
}
