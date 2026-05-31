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

  const body = await request.json();
  const { invoice_id, override_email } = body;

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

  const recipientEmail = override_email || invoice.to_email;
  if (!recipientEmail) {
    return Response.json({ error: "No recipient email — enter a send-to email address above the Send button" }, { status: 400 });
  }

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
    .single();
  const orgTimezone = orgSettings?.timezone || "UTC";
  const orgRegisteredName = orgSettings?.registered_business_name || null;
  const orgDba = orgSettings?.dba || null;

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
      to: [recipientEmail],
      subject: `Invoice ${invoice.invoice_number} — ${invoice.from_name || "Toni Colina"}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const resendError = await resendRes.text();
    return Response.json(
      { error: `Failed to send email: ${resendError}` },
      { status: 500 }
    );
  }

  // Update invoice status to sent
  await serviceClient
    .from("invoices")
    .update({
      status: invoice.status === "draft" ? "sent" : invoice.status,
      sent_at: new Date().toISOString(),
    })
    .eq("id", invoice_id);

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
  reminder_enabled: boolean | null;
  account_name: string | null;
  service_type: string | null;
  status: string;
}

interface LineItemRow {
  description: string;
  va_name: string | null;
  quantity: number;
  project: string | null;
  account_name: string | null;
  client_memo: string | null;
}

/* ── Helpers ──────────────────────────────────────────────── */

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function fmtHours(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} hrs ${mins} mins` : `${hrs} hrs`;
}

/* ── Build Invoice HTML Email ─────────────────────────────── */

function buildInvoiceEmail(
  invoice: InvoiceRow,
  items: LineItemRow[],
  timezone = "UTC",
  orgRegisteredName: string | null = null,
  orgDba: string | null = null
): string {
  const totalHours = items.reduce((s, li) => s + Number(li.quantity), 0);
  const adjustment = Number(invoice.adjustment_amount || 0);
  const invoiceAmount = Number(invoice.subtotal);
  const finalTotal = Number(invoice.total);

  // Issue date formatted
  const issueDateFmt = new Date(invoice.issue_date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  });

  // Task summary: group by description
  const taskMap: Record<string, number> = {};
  items.forEach((li) => {
    const k = li.description || "Other";
    taskMap[k] = (taskMap[k] || 0) + Number(li.quantity);
  });
  const taskSummary = Object.entries(taskMap).sort((a, b) => b[1] - a[1]);

  // Project summary: group by project
  const projMap: Record<string, number> = {};
  items.forEach((li) => {
    const k = li.project || li.account_name || "Unassigned";
    projMap[k] = (projMap[k] || 0) + Number(li.quantity);
  });
  const projSummary = Object.entries(projMap).sort((a, b) => b[1] - a[1]);

  // Time allocation rows
  const timeRows = items
    .map(
      (li) => `
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #e8e0d4; text-align:right; font-size:13px; color:#3d2b1f; font-weight:600;">${Math.round(Number(li.quantity) * 60)}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #e8e0d4; font-size:13px; color:#3d2b1f;">${li.description}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #e8e0d4; font-size:13px; color:#6b5e52;">${li.project || li.account_name || "—"}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #e8e0d4; font-size:12px; color:#6b5e52;">${li.client_memo || "—"}</td>
      </tr>`
    )
    .join("");

  // Task summary rows
  const taskRows = taskSummary
    .map(
      ([task, hrs]) => `
      <tr>
        <td style="padding:5px 0; font-size:13px; color:#e8e0d4;">${task}</td>
        <td style="padding:5px 0; font-size:13px; color:#ffffff; text-align:right; font-weight:600; white-space:nowrap;">${fmtHours(hrs)}</td>
      </tr>`
    )
    .join("");

  // Project summary rows
  const projRows = projSummary
    .map(
      ([proj, hrs]) => `
      <tr>
        <td style="padding:5px 0; font-size:13px; color:#e8e0d4;">${proj}</td>
        <td style="padding:5px 0; font-size:13px; color:#ffffff; text-align:right; font-weight:600; white-space:nowrap;">${fmtHours(hrs)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f5f0e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px; margin:0 auto; padding:24px 16px;">

    <!-- ── PAGE 1 ─────────────────────────────────────── -->

    <!-- Yellow header card -->
    <div style="background:#f5c842; border-radius:12px 12px 0 0; padding:28px 32px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <!-- Left: invoice info + client -->
          <td style="vertical-align:top; width:55%;">
            <div style="font-size:12px; font-weight:700; color:#5a4000; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">
              INVOICE: ${issueDateFmt}
            </div>
            ${invoice.service_type ? `<div style="font-size:11px; color:#5a4000; margin-bottom:6px; font-style:italic;">${invoice.service_type}</div>` : "<div style=\"margin-bottom:6px;\"></div>"}
            <div style="font-size:11px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">BILL TO:</div>
            <div style="font-size:22px; font-weight:800; color:#2d1a00; line-height:1.2; margin-bottom:4px;">${invoice.to_name}</div>
            ${invoice.to_contact ? `<div style="font-size:12px; color:#5a4000;">${invoice.to_contact}</div>` : ""}
            ${invoice.to_email ? `<div style="font-size:12px; color:#5a4000;">${invoice.to_email}</div>` : ""}
            ${invoice.to_phone ? `<div style="font-size:12px; color:#5a4000;">${invoice.to_phone}</div>` : ""}
            <div style="margin-top:16px;">
              <div style="font-size:11px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px;">INVOICE AMOUNT</div>
              <div style="font-size:28px; font-weight:800; color:#2d1a00;">${formatCurrency(finalTotal, invoice.currency)}</div>
            </div>
          </td>
          <!-- Right: sender info -->
          <td style="vertical-align:top; text-align:right; padding-left:20px;">
            ${invoice.account_name ? `<div style="font-size:11px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">Account: ${invoice.account_name}</div>` : ""}
            ${orgRegisteredName ? `<div style="font-size:15px; font-weight:800; color:#2d1a00; line-height:1.3;">${orgRegisteredName}</div>` : `<div style="font-size:15px; font-weight:700; color:#2d1a00;">${invoice.from_name}</div>`}
            ${orgDba && orgDba !== orgRegisteredName ? `<div style="font-size:11px; color:#5a4000; margin-top:1px;">DBA: ${orgDba}</div>` : ""}
            ${!orgRegisteredName && invoice.from_name ? "" : orgRegisteredName !== invoice.from_name ? `<div style="font-size:12px; color:#5a4000; margin-top:2px;">${invoice.from_name}</div>` : ""}
            ${invoice.from_phone ? `<div style="font-size:12px; color:#5a4000; margin-top:2px;">${invoice.from_phone}</div>` : ""}
            ${invoice.from_email ? `<div style="font-size:12px; color:#5a4000; margin-top:2px;">${invoice.from_email}</div>` : ""}
            ${invoice.payment_link ? `
            <div style="margin-top:12px;">
              <div style="font-size:11px; font-weight:600; color:#5a4000; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Pay Online</div>
              <a href="${invoice.payment_link}" style="display:inline-block; background:#2d1a00; color:#f5c842; font-size:12px; font-weight:700; padding:8px 16px; border-radius:6px; text-decoration:none;">Click to Pay</a>
            </div>` : ""}
          </td>
        </tr>
      </table>
    </div>

    <!-- Tab 1 label -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:10px 32px 0 32px;">
      <span style="display:inline-flex; align-items:center; gap:8px;">
        <span style="display:inline-block; background:#f5c842; color:#2d1a00; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; padding:3px 8px; border-radius:4px;">TAB 1</span>
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52;">Invoice Summary</span>
      </span>
    </div>

    <!-- Invoice Summary box -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:12px 32px 20px 32px;">
      <table style="width:100%; border-collapse:collapse; border:1px solid #e8e0d4; border-radius:8px; overflow:hidden;">
        <tr style="background:#faf6f0;">
          <td style="padding:12px 16px; text-align:center; border-right:1px solid #e8e0d4;">
            <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52;">Total Hours</div>
            <div style="font-size:20px; font-weight:700; color:#3d2b1f; margin-top:4px;">${totalHours.toFixed(2)}</div>
          </td>
          <td style="padding:12px 16px; text-align:center; border-right:1px solid #e8e0d4;">
            <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52;">Invoice Amount</div>
            <div style="font-size:20px; font-weight:700; color:#3d2b1f; margin-top:4px;">${formatCurrency(invoiceAmount, invoice.currency)}</div>
          </td>
          <td style="padding:12px 16px; text-align:center; border-right:1px solid #e8e0d4;">
            <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52;">Adjustment</div>
            <div style="font-size:20px; font-weight:700; color:#3d2b1f; margin-top:4px;">${adjustment > 0 ? `− ${formatCurrency(adjustment)}` : "$0"}</div>
          </td>
          <td style="padding:12px 16px; text-align:center;">
            <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52;">Final Amount</div>
            <div style="font-size:20px; font-weight:700; color:#c0704e; margin-top:4px;">${formatCurrency(finalTotal, invoice.currency)}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Task + Project Summary (navy) -->
    <div style="background:#2d3a4a; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:20px 32px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <!-- Task Summary -->
          <td style="vertical-align:top; width:50%; padding-right:16px; border-right:1px solid #4a5568;">
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#f5c842; margin-bottom:12px;">Top Task Summary</div>
            <table style="width:100%; border-collapse:collapse;">
              ${taskRows}
            </table>
          </td>
          <!-- Project Summary -->
          <td style="vertical-align:top; padding-left:16px;">
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#f5c842; margin-bottom:12px;">Top Deliverables / Objectives</div>
            <table style="width:100%; border-collapse:collapse;">
              ${projRows}
            </table>
          </td>
        </tr>
      </table>
    </div>

    ${invoice.notes ? `
    <!-- Notes -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; padding:16px 32px;">
      <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; margin-bottom:6px;">Notes</div>
      <div style="font-size:13px; color:#3d2b1f; white-space:pre-line;">${invoice.notes}</div>
    </div>` : ""}

    <!-- ── TAB 2: DETAILED TIME ALLOCATION ───────────── -->

    <!-- Tab divider -->
    <div style="background:#e8e0d4; height:3px; margin:0;"></div>

    <!-- Tab 2 header -->
    <div style="background:#2d1a00; border-left:1px solid #2d1a00; border-right:1px solid #2d1a00; padding:10px 32px; display:flex; align-items:center; gap:16px;">
      <div style="display:inline-block; background:#f5c842; color:#2d1a00; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px; padding:4px 10px; border-radius:4px; margin-right:10px;">TAB 2</div>
      <span style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#f5c842;">Detailed Time Allocation</span>
    </div>

    <!-- Time Allocation table -->
    <div style="background:#ffffff; border-left:1px solid #e8e0d4; border-right:1px solid #e8e0d4; border-bottom:1px solid #e8e0d4; border-radius:0 0 12px 12px; overflow:hidden;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="background:#faf6f0;">
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; border-bottom:1px solid #e8e0d4; white-space:nowrap;">Time in Minutes</th>
            <th style="padding:10px 12px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; border-bottom:1px solid #e8e0d4;">Task Description</th>
            <th style="padding:10px 12px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; border-bottom:1px solid #e8e0d4;">Deliverables / Objectives</th>
            <th style="padding:10px 12px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6b5e52; border-bottom:1px solid #e8e0d4;">Memo</th>
          </tr>
        </thead>
        <tbody>
          ${timeRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="padding:16px 0; text-align:center;">
      <div style="font-size:11px; color:#9e9080;">Sent by ${invoice.from_name} · MinuteFlow</div>
    </div>

  </div>
</body>
</html>`;
}
