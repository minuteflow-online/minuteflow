import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** POST: Send invoice via email using Resend */
export async function POST(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin role check — only admins may send invoices
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (senderProfile?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { invoice_id, override_email, cc_emails } = body;

  if (!invoice_id) {
    return Response.json({ error: "invoice_id is required" }, { status: 400 });
  }

  // Use service role client to fetch invoice data
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch invoice
  const { data: invoice, error: invError } = await serviceClient
    .from("invoices")
    .select("*")
    .eq("id", invoice_id)
    .single();

  if (invError || !invoice) {
    return Response.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Parse To: use override_email if provided (admin typed a different address),
  // otherwise fall back to the invoice's recorded to_email.
  const rawTo = override_email && override_email.trim() ? override_email : invoice.to_email;
  const recipientEmails: string[] = Array.isArray(rawTo)
    ? rawTo.map((e: string) => e.trim()).filter(Boolean)
    : typeof rawTo === "string"
    ? rawTo.split(",").map((e: string) => e.trim()).filter(Boolean)
    : [];

  if (recipientEmails.length === 0) {
    return Response.json({ error: "No recipient email — enter a send-to email address above the Send button" }, { status: 400 });
  }

  // Parse CC emails if provided
  const ccEmails: string[] = cc_emails && cc_emails.trim()
    ? cc_emails.split(",").map((e: string) => e.trim()).filter(Boolean)
    : [];

  // Fetch line items
  const { data: lineItems } = await serviceClient
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoice_id)
    .order("sort_order", { ascending: true });

  const items = lineItems ?? [];

  // Fetch org settings
  const { data: orgSettings } = await serviceClient
    .from("organization_settings")
    .select("timezone, registered_business_name, dba")
    .limit(1)
    .single();
  const orgTimezone = orgSettings?.timezone || "UTC";
  const orgRegisteredName = orgSettings?.registered_business_name || null;
  const orgDba = invoice.dba || orgSettings?.dba || null;

  // Build HTML email
  const html = buildInvoiceEmail(invoice, items, orgTimezone, orgRegisteredName, orgDba);

  // Send via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({ error: "Resend API key not configured" }, { status: 500 });
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${invoice.from_name || "Toni Colina"} <noreply@minuteflow.click>`,
      to: recipientEmails,
      ...(ccEmails.length > 0 ? { cc: ccEmails } : {}),
      ...(invoice.from_email ? { reply_to: invoice.from_email } : {}),
      subject: `Invoice ${invoice.invoice_number} — ${invoice.from_name || "Toni Colina"}`,
      html,
      open_tracking: true,
      click_tracking: true,
    }),
  });

  if (!resendRes.ok) {
    const resendError = await resendRes.text();
    return Response.json(
      { error: `Failed to send email: ${resendError}` },
      { status: 500 }
    );
  }

  // Capture message ID for tracking
  let invoiceResendMessageId: string | null = null;
  try {
    const resendData = await resendRes.json() as { id?: string };
    if (resendData.id) invoiceResendMessageId = resendData.id;
  } catch { /* non-fatal */ }

  // Update invoice status to sent
  await serviceClient
    .from("invoices")
    .update({
      status: invoice.status === "draft" ? "sent" : invoice.status,
      sent_at: new Date().toISOString(),
      resend_message_id: invoiceResendMessageId,
    })
    .eq("id", invoice_id);

  // Log every send: actual sent-to address + CC
  await serviceClient
    .from("invoice_send_log")
    .insert({
      invoice_id: invoice_id,
      invoice_number: invoice.invoice_number,
      sent_to: recipientEmails.join(", "),
      cc_emails: ccEmails.length > 0 ? ccEmails.join(", ") : null,
      resend_message_id: invoiceResendMessageId,
    });

  return Response.json({ success: true });
}

/* ── Types ────────────────────────────────────────────────── */

interface InvoiceRow {
  invoice_number: string;
  from_name: string;
  from_phone: string | null;
  from_address: string | null;
  from_email: string | null;
  from_logo_url: string | null;
  to_name: string;
  to_contact: string | null;
  to_email: string | null;
  to_phone: string | null;
  to_address: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  adjustment_amount: number | null;
  total: number;
  currency: string;
  notes: string | null;
  payment_link: string | null;
  payment_info: string | null;
  share_token: string | null;
  reminder_enabled: boolean | null;
  account_name: string | null;
  service_type: string | null;
  status: string;
  rate_amount: number | null;
  hours_not_billed: number | null;
  hours_not_billed_label: string | null;
  previous_balance: number | null;
  previous_balance_note: string | null;
  invoice_type?: string | null;
  custom_line_items?: string | null;
  period_start: string | null;
  period_end: string | null;
  payment_schedule?: Array<{ label: string; amount_type: string; value: number }> | null;
  dba?: string | null;
}

interface LineItemRow {
  description: string;
  va_name: string | null;
  quantity: number;
  project: string | null;
  account_name: string | null;
  client_memo: string | null;
  expense_id: number | null;
  amount: number;
  service_date: string | null;
}

/* ── Helpers ──────────────────────────────────────────────── */

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

/* ── Build Invoice HTML Email ─────────────────────────────── */

function buildInvoiceEmail(
  invoice: InvoiceRow,
  _items: LineItemRow[],
  timezone = "UTC",
  orgRegisteredName: string | null = null,
  orgDba: string | null = null
): string {
  const finalTotal = Number(invoice.total);
  const prevBalance = Number(invoice.previous_balance || 0);
  const currentBalance = finalTotal + prevBalance;

  // Date display — show period range if available, otherwise issue date
  const issueDateFmt = new Date(invoice.issue_date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  });
  const dateDisplay = invoice.period_start && invoice.period_end
    ? `${new Date(invoice.period_start + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(invoice.period_end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : issueDateFmt;

  // PDF view link
  const pdfLink = invoice.share_token
    ? `https://minuteflow.click/invoice/view/${invoice.share_token}`
    : null;

  // Square payment links
  const hasSchedule = invoice.payment_schedule && invoice.payment_schedule.length > 0;
  // Full payment link — always available when share_token exists
  const squareFullLink = invoice.share_token
    ? `https://minuteflow.click/invoice/pay/${invoice.share_token}?mode=full`
    : null;
  // Split payment link — only when a payment schedule is configured
  const squareSplitLink = hasSchedule && invoice.share_token
    ? `https://minuteflow.click/invoice/pay/${invoice.share_token}`
    : null;

  // Display amount in header: current balance if prev balance, otherwise final total
  const headerAmount = prevBalance > 0 ? currentBalance : finalTotal;
  const headerAmountLabel = prevBalance > 0 ? "Balance Due" : "Invoice Amount";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @media only screen and (max-width: 600px) {
      .invoice-header-col {
        display: block !important;
        width: 100% !important;
        padding: 14px 0 !important;
        border-left: none !important;
        border-right: none !important;
        border-top: 1px solid #c9a820 !important;
        box-sizing: border-box !important;
      }
      .invoice-header-col-first {
        border-top: none !important;
        padding-top: 0 !important;
      }
      .invoice-header-col-right {
        text-align: left !important;
      }
      td.bdc {
        display: inline-block !important;
        width: 48% !important;
        border-right: none !important;
        border-bottom: 1px solid #e8e0d4 !important;
        box-sizing: border-box !important;
      }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f5f0e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px; margin:0 auto; padding:24px 16px;">

    <!-- ── YELLOW HEADER — 3 COLUMNS ─────────────────────── -->
    <div style="background:#f5c842; border-radius:12px 12px 0 0; padding:24px 28px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <!-- Col 1: Client Info -->
          <td class="invoice-header-col invoice-header-col-first" style="vertical-align:top; width:34%;">
            <div style="font-size:10px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">BILL TO:</div>
            ${invoice.account_name ? `<div style="font-size:18px; font-weight:800; color:#2d1a00; line-height:1.2; margin-bottom:2px;">${invoice.account_name}</div>` : ""}
            <div style="font-weight:800; color:#2d1a00; line-height:1.2; margin-bottom:3px; font-size:${invoice.account_name ? "13px" : "18px"};">${invoice.to_name}</div>
            ${invoice.to_contact ? `<div style="font-size:11px; color:#5a4000;">${invoice.to_contact}</div>` : ""}
            ${invoice.to_email ? `<div style="font-size:11px; color:#5a4000;">${invoice.to_email}</div>` : ""}
            ${invoice.to_phone ? `<div style="font-size:11px; color:#5a4000;">${invoice.to_phone}</div>` : ""}
            ${invoice.to_address ? `<div style="font-size:10px; color:#5a4000; margin-top:2px;">${invoice.to_address}</div>` : ""}
            <div style="margin-top:14px;">
              <div style="font-size:10px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px;">${headerAmountLabel}</div>
              <div style="font-size:24px; font-weight:800; color:#2d1a00;">${formatCurrency(headerAmount, invoice.currency)}</div>
              <div style="margin-top:8px;">
                <div style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#5a4000; margin-bottom:2px;">Invoice Date</div>
                <div style="font-size:13px; font-weight:600; color:#2d1a00; margin-top:2px;">${dateDisplay}</div>
              </div>
            </div>
          </td>

          <!-- Col 2: Invoice From -->
          <td class="invoice-header-col" style="vertical-align:top; text-align:left; width:32%; padding:0 16px; border-left:1px solid #c9a820; border-right:1px solid #c9a820;">
            <div style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#5a4000; margin-bottom:3px;">INVOICE FROM:</div>
            <div style="font-size:14px; font-weight:700; color:#2d1a00;">${invoice.from_name}</div>
            ${orgRegisteredName ? `<div style="font-size:12px; font-weight:600; color:#2d1a00; margin-top:3px;">${orgRegisteredName}</div>` : ""}
            ${orgDba ? `<div style="font-size:11px; color:#5a4000; margin-top:1px;">DBA: ${orgDba}</div>` : ""}
            ${invoice.from_phone ? `<div style="font-size:11px; color:#5a4000; margin-top:2px;">${invoice.from_phone}</div>` : ""}
            ${invoice.from_email ? `<div style="font-size:11px; color:#5a4000; margin-top:2px;">${invoice.from_email}</div>` : ""}
            ${invoice.service_type ? `<div style="font-size:11px; font-weight:600; color:#5a4000; margin-top:4px;">${invoice.service_type}</div>` : ""}
            <div style="margin-top:14px;">
              <div style="font-size:11px; font-weight:700; color:#2d1a00;">#${invoice.invoice_number}</div>
              ${invoice.due_date ? `<div style="font-size:10px; color:#5a4000; margin-top:2px;">Due: ${new Date(invoice.due_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone })}</div>` : ""}
            </div>
          </td>

          <!-- Col 3: Payment Methods -->
          <td class="invoice-header-col invoice-header-col-right" style="vertical-align:top; text-align:right; width:34%; padding-left:12px;">
            <div style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#5a4000; margin-bottom:6px;">HOW TO PAY</div>
            ${invoice.payment_info ? `<div style="font-size:11px; color:#5a4000; white-space:pre-line; text-align:right; margin-bottom:8px;">${invoice.payment_info}</div>` : ""}
            ${squareSplitLink ? `
            <div style="margin-top:4px;">
              <a href="${squareFullLink}" style="display:inline-block; background:#2d6a4f; color:#ffffff; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Pay in Full with Card</a>
              <div style="height:6px;"></div>
              <a href="${squareSplitLink}" style="display:inline-block; background:#2d6a4f; color:#ffffff; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Split Payments</a>
              <div style="font-size:9px; color:#5a4000; margin-top:3px;">Secure payment via Square</div>
            </div>` : squareFullLink ? `
            <div style="margin-top:4px;">
              <a href="${squareFullLink}" style="display:inline-block; background:#2d6a4f; color:#ffffff; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Pay in Full with Card</a>
              <div style="font-size:9px; color:#5a4000; margin-top:3px;">Secure payment via Square</div>
            </div>` : invoice.payment_link ? `
            <div style="margin-top:4px;">
              <a href="${invoice.payment_link}" style="display:inline-block; background:#2d1a00; color:#f5c842; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Pay Online</a>
              <div style="font-size:9px; color:#5a4000; margin-top:3px;">*3% processing fee applies</div>
            </div>` : ""}
          </td>
        </tr>
      </table>
    </div>


    ${invoice.notes ? `
    <!-- ── NOTES ────────────────────────────────────────── -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:16px 32px;">
      <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; margin-bottom:6px;">Notes</div>
      <div style="font-size:13px; color:#3d2b1f; white-space:pre-line;">${invoice.notes}</div>
    </div>` : ""}

    ${pdfLink ? `
    <!-- ── VIEW FULL DETAILS ──────────────────────────────── -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; border-bottom:1px solid #e8e0d4; border-radius:0 0 12px 12px; padding:24px 32px; text-align:center;">
      <div style="font-size:12px; color:#6b5e52; margin-bottom:12px;">Full time breakdown, detailed logs, and more</div>
      <a href="${pdfLink}" style="display:inline-block; background:#2d3a4a; color:#ffffff; font-size:13px; font-weight:700; padding:12px 28px; border-radius:8px; text-decoration:none;">View Full Invoice Details →</a>
      <div style="font-size:11px; color:#9e9080; margin-top:8px;">View &amp; download your invoice with complete time allocation</div>
    </div>` : `
    <!-- ── BOTTOM BORDER ─────────────────────────────────── -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; border-bottom:1px solid #e8e0d4; border-radius:0 0 12px 12px; height:16px;"></div>`}

    <!-- ── FOOTER ────────────────────────────────────────── -->
    <div style="padding:16px 0; text-align:center;">
      <div style="font-size:11px; color:#9e9080;">Sent by ${invoice.from_name} · MinuteFlow</div>
    </div>

  </div>
</body>
</html>`;
}
