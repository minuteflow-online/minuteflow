import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/send-receipt
 * Sends a payment receipt email to the client for an invoice.
 * Called by the admin dashboard after manually recording a payment.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.invoiceId) {
    return Response.json({ error: "invoiceId required" }, { status: 400 });
  }

  const { invoiceId, amountPaid, newAmountPaid, newStatus } = body;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return Response.json({ error: "Email service not configured" }, { status: 500 });
  }

  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: invoice, error } = await serviceClient
    .from("invoices")
    .select("invoice_number, to_name, to_email, total, currency")
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) {
    return Response.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (!invoice.to_email) {
    return Response.json({ ok: true, skipped: "no client email on invoice" });
  }

  const total = Number(invoice.total);
  const paid = Number(newAmountPaid ?? amountPaid ?? 0);
  const balanceRemaining = Math.max(0, total - paid);
  const isPaid = (newStatus === "paid") || paid >= total - 0.01;
  const currency = invoice.currency || "USD";
  const currencyLabel = currency !== "USD" ? ` ${currency}` : "";

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#1a1a2e;padding:28px 32px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#9ca3af;letter-spacing:0.05em;text-transform:uppercase;">MinuteFlow</p>
        <h1 style="margin:8px 0 0;font-size:24px;color:#fff;font-weight:700;">Payment ${isPaid ? "Received" : "Recorded"}</h1>
      </div>
      <div style="padding:32px;">
        <p style="margin:0 0 24px;font-size:15px;color:#374151;">Hi ${invoice.to_name ?? "there"},</p>
        <p style="margin:0 0 24px;font-size:15px;color:#374151;">
          We have received your payment of <strong>${fmt(Number(amountPaid))}${currencyLabel}</strong> for Invoice <strong>${invoice.invoice_number}</strong>.
          ${isPaid ? "This invoice is now <strong>paid in full</strong>. Thank you!" : `Your remaining balance is <strong>${fmt(balanceRemaining)}${currencyLabel}</strong>.`}
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Invoice</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${invoice.invoice_number}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Payment Amount</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${fmt(Number(amountPaid))}${currencyLabel}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Invoice Total</td>
              <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">${fmt(total)}${currencyLabel}</td>
            </tr>
            ${!isPaid ? `<tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Balance Remaining</td>
              <td style="padding:6px 0;font-size:14px;color:#d97706;font-weight:600;text-align:right;">${fmt(balanceRemaining)}${currencyLabel}</td>
            </tr>` : `<tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Status</td>
              <td style="padding:6px 0;font-size:14px;color:#16a34a;font-weight:600;text-align:right;">Paid in Full</td>
            </tr>`}
          </table>
        </div>
        <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">Questions? Reply to this email or contact your account manager.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MinuteFlow <noreply@minuteflow.click>",
      to: [invoice.to_email],
      subject: `Payment Receipt — Invoice ${invoice.invoice_number}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.json().catch(() => ({}));
    console.error("send-receipt email failed:", err);
    return Response.json({ error: "Failed to send receipt email" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
