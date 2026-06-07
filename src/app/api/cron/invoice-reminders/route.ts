import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/invoice-reminders
 * Daily cron: send gentle reminder emails for invoices with daily_reminder=true
 * that are NOT paid, cancelled, or trash.
 * Secured by CRON_SECRET (set in Vercel env + vercel.json crons).
 */
export async function GET(request: NextRequest) {
  // Verify this is a legitimate cron call
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch all invoices with reminders enabled that aren't done
  const { data: invoices, error } = await serviceClient
    .from("invoices")
    .select("*")
    .eq("daily_reminder", true)
    .not("status", "in", '("paid","cancelled","trash")')
    .not("to_email", "is", null);

  if (error) {
    console.error("[cron/invoice-reminders] Failed to fetch invoices:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!invoices || invoices.length === 0) {
    return Response.json({ sent: 0, message: "No invoices eligible for reminders" });
  }

  // Fetch org settings once
  const { data: orgSettings } = await serviceClient
    .from("organization_settings")
    .select("timezone, registered_business_name, dba")
    .limit(1)
    .single();
  const orgTimezone = orgSettings?.timezone || "UTC";
  const orgRegisteredName = orgSettings?.registered_business_name || null;
  const orgDba = orgSettings?.dba || null;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({ error: "Resend API key not configured" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const invoice of invoices) {
    try {
      // Fetch line items for this invoice
      const { data: lineItems } = await serviceClient
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("sort_order", { ascending: true });

      const items = lineItems ?? [];
      const html = buildInvoiceEmail(invoice, items, orgTimezone, orgRegisteredName, orgDba);

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${invoice.from_name || "Toni Colina"} <noreply@minuteflow.click>`,
          to: [invoice.to_email],
          ...(invoice.from_email ? { reply_to: invoice.from_email } : {}),
          subject: `Gentle Reminder: Invoice ${invoice.invoice_number} — ${invoice.from_name || "Toni Colina"}`,
          html,
        }),
      });

      if (resendRes.ok) {
        sent++;
        console.log(`[cron/invoice-reminders] Sent reminder for invoice ${invoice.invoice_number} to ${invoice.to_email}`);
      } else {
        const errText = await resendRes.text();
        failed++;
        failures.push(`Invoice ${invoice.invoice_number}: ${errText}`);
        console.error(`[cron/invoice-reminders] Failed for invoice ${invoice.invoice_number}:`, errText);
      }
    } catch (err) {
      failed++;
      failures.push(`Invoice ${invoice.invoice_number}: ${String(err)}`);
      console.error(`[cron/invoice-reminders] Exception for invoice ${invoice.invoice_number}:`, err);
    }
  }

  return Response.json({
    sent,
    failed,
    total: invoices.length,
    ...(failures.length > 0 ? { failures } : {}),
  });
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

  const issueDateFmt = new Date(invoice.issue_date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  });
  const dateDisplay =
    invoice.period_start && invoice.period_end
      ? `${new Date(invoice.period_start + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(invoice.period_end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : issueDateFmt;

  const pdfLink = invoice.share_token
    ? `https://minuteflow.click/invoice/view/${invoice.share_token}`
    : null;

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
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f5f0e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px; margin:0 auto; padding:24px 16px;">

    <!-- ── YELLOW HEADER — 3 COLUMNS ─────────────────────── -->
    <div style="background:#f5c842; border-radius:12px 12px 0 0; padding:24px 28px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
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

          <td class="invoice-header-col invoice-header-col-right" style="vertical-align:top; text-align:right; width:34%; padding-left:12px;">
            <div style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#5a4000; margin-bottom:6px;">HOW TO PAY</div>
            ${invoice.payment_info ? `<div style="font-size:11px; color:#5a4000; white-space:pre-line; text-align:right; margin-bottom:8px;">${invoice.payment_info}</div>` : ""}
            ${invoice.payment_link ? `
            <div style="margin-top:4px;">
              <a href="${invoice.payment_link}" style="display:inline-block; background:#2d1a00; color:#f5c842; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Pay Online</a>
              <div style="font-size:9px; color:#5a4000; margin-top:3px;">*3% processing fee applies</div>
            </div>` : ""}
          </td>
        </tr>
      </table>
    </div>

    ${invoice.notes ? `
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:16px 32px;">
      <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; margin-bottom:6px;">Notes</div>
      <div style="font-size:13px; color:#3d2b1f; white-space:pre-line;">${invoice.notes}</div>
    </div>` : ""}

    ${pdfLink ? `
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; border-bottom:1px solid #e8e0d4; border-radius:0 0 12px 12px; padding:24px 32px; text-align:center;">
      <div style="font-size:12px; color:#6b5e52; margin-bottom:12px;">Full time breakdown, detailed logs, and more</div>
      <a href="${pdfLink}" style="display:inline-block; background:#2d3a4a; color:#ffffff; font-size:13px; font-weight:700; padding:12px 28px; border-radius:8px; text-decoration:none;">View Full Invoice Details →</a>
      <div style="font-size:11px; color:#9e9080; margin-top:8px;">View &amp; download your invoice with complete time allocation</div>
    </div>` : `
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; border-bottom:1px solid #e8e0d4; border-radius:0 0 12px 12px; height:16px;"></div>`}

    <div style="padding:16px 0; text-align:center;">
      <div style="font-size:11px; color:#9e9080;">Sent by ${invoice.from_name} · MinuteFlow</div>
    </div>

  </div>
</body>
</html>`;
}
