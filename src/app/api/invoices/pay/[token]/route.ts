import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** GET /api/invoices/pay/[token] — public, no auth — returns invoice + payment info for the payment page */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return Response.json({ error: "Token required" }, { status: 400 });

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: invoice, error } = await serviceClient
    .from("invoices")
    .select("id, invoice_number, to_name, to_email, total, currency, status, amount_paid, allow_custom_amount, show_all_installments, payment_schedule")
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
  const balanceDue = Math.max(0, Number(invoice.total) - amountPaid);

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
  const { token } = await params;
  if (!token) return Response.json({ error: "Token required" }, { status: 400 });

  const body = await request.json();
  const { sourceId, amount, idempotencyKey } = body;

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
    .select("id, invoice_number, to_name, total, currency, status, amount_paid, allow_custom_amount, payment_schedule")
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
  const balanceDue = Math.max(0, Number(invoice.total) - alreadyPaid);

  if (balanceDue <= 0) {
    return Response.json({ error: "This invoice has already been paid in full" }, { status: 400 });
  }

  const payAmount = Number(amount);

  // Validate amount does not exceed balance
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
        amount: Math.round(payAmount * 100), // Square uses cents
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
      payment_method: "Square",
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

  // Update invoice status
  const newAmountPaid = alreadyPaid + payAmount;
  const newStatus = newAmountPaid >= Number(invoice.total) - 0.01 ? "paid" : "partially_paid";

  await serviceClient
    .from("invoices")
    .update({
      status: newStatus,
      amount_paid: newAmountPaid,
      ...(newStatus === "paid" ? { paid_date: new Date().toISOString().split("T")[0] } : {}),
    })
    .eq("id", invoice.id);

  return Response.json({
    success: true,
    receiptUrl: squarePayment?.receipt_url ?? null,
    amountPaid: payAmount,
    newStatus,
    balanceRemaining: Math.max(0, Number(invoice.total) - newAmountPaid),
  });
}
