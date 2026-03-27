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
  const { invoice_id } = body;

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

  if (!invoice.to_email) {
    return Response.json({ error: "Invoice has no recipient email" }, { status: 400 });
  }

  // Fetch line items
  const { data: lineItems } = await serviceClient
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoice_id)
    .order("sort_order", { ascending: true });

  const items = lineItems ?? [];

  // Build HTML email
  const html = buildInvoiceEmail(invoice, items);

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
      from: `${invoice.from_name || "MinuteFlow"} <noreply@minuteflow.click>`,
      to: [invoice.to_email],
      subject: `Invoice ${invoice.invoice_number} from ${invoice.from_name || "MinuteFlow"}`,
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

/* ── Build Invoice HTML Email ─────────────────────────────── */

interface InvoiceRow {
  invoice_number: string;
  from_name: string;
  from_address: string | null;
  from_email: string | null;
  from_logo_url: string | null;
  to_name: string;
  to_contact: string | null;
  to_email: string | null;
  to_address: string | null;
  issue_date: string;
  due_date: string | null;
  payment_terms: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  currency: string;
  notes: string | null;
  status: string;
}

interface LineItemRow {
  description: string;
  va_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
}

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function paymentTermsLabel(terms: string | null) {
  const labels: Record<string, string> = {
    due_on_receipt: "Due on Receipt",
    net_15: "Net 15",
    net_30: "Net 30",
    net_45: "Net 45",
    net_60: "Net 60",
  };
  return labels[terms || ""] || terms || "Net 30";
}

function buildInvoiceEmail(invoice: InvoiceRow, items: LineItemRow[]): string {
  const lineItemsHtml = items
    .map(
      (li) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e8e0d4; color: #3d2b1f; font-size: 13px;">${li.description}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e8e0d4; color: #6b5e52; font-size: 13px;">${li.va_name || "-"}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e8e0d4; color: #6b5e52; font-size: 13px; text-align: right;">${Number(li.quantity).toFixed(2)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #e8e0d4; color: #6b5e52; font-size: 13px; text-align: right;">${formatCurrency(Number(li.unit_price), invoice.currency)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e8e0d4; color: #3d2b1f; font-size: 13px; text-align: right; font-weight: 600;">${formatCurrency(Number(li.amount), invoice.currency)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 32px 16px;">
    <!-- Header -->
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">
      <div style="padding: 32px;">
        <!-- From / Invoice header -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: top;">
              ${invoice.from_logo_url ? `<img src="${invoice.from_logo_url}" alt="" style="height: 40px; width: auto; margin-bottom: 8px;" />` : ""}
              <div style="font-size: 18px; font-weight: 700; color: #3d2b1f;">${invoice.from_name}</div>
              ${invoice.from_address ? `<div style="font-size: 12px; color: #6b5e52; margin-top: 4px; white-space: pre-line;">${invoice.from_address}</div>` : ""}
              ${invoice.from_email ? `<div style="font-size: 12px; color: #6b5e52; margin-top: 2px;">${invoice.from_email}</div>` : ""}
            </td>
            <td style="vertical-align: top; text-align: right;">
              <div style="font-size: 28px; font-weight: 700; color: #c0704e;">INVOICE</div>
              <div style="font-size: 14px; font-weight: 600; color: #3d2b1f; margin-top: 4px;">${invoice.invoice_number}</div>
              <div style="font-size: 11px; color: #6b5e52; margin-top: 8px;">
                <strong style="color: #3d2b1f;">Issue Date:</strong> ${new Date(invoice.issue_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
              ${
                invoice.due_date
                  ? `<div style="font-size: 11px; color: #6b5e52; margin-top: 2px;">
                      <strong style="color: #3d2b1f;">Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>`
                  : ""
              }
              ${
                invoice.payment_terms
                  ? `<div style="font-size: 11px; color: #6b5e52; margin-top: 2px;">
                      <strong style="color: #3d2b1f;">Terms:</strong> ${paymentTermsLabel(invoice.payment_terms)}
                    </div>`
                  : ""
              }
            </td>
          </tr>
        </table>

        <!-- Bill To -->
        <div style="margin-top: 24px; padding: 16px; background: #faf6f0; border-radius: 8px;">
          <div style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; margin-bottom: 4px;">Bill To</div>
          <div style="font-size: 14px; font-weight: 700; color: #3d2b1f;">${invoice.to_name}</div>
          ${invoice.to_contact ? `<div style="font-size: 12px; color: #6b5e52;">${invoice.to_contact}</div>` : ""}
          ${invoice.to_email ? `<div style="font-size: 12px; color: #6b5e52;">${invoice.to_email}</div>` : ""}
          ${invoice.to_address ? `<div style="font-size: 12px; color: #6b5e52; margin-top: 4px; white-space: pre-line;">${invoice.to_address}</div>` : ""}
        </div>

        <!-- Line Items -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 24px; border: 1px solid #e8e0d4; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #faf6f0;">
              <th style="padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; border-bottom: 1px solid #e8e0d4;">Description</th>
              <th style="padding: 10px 8px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; border-bottom: 1px solid #e8e0d4;">VA</th>
              <th style="padding: 10px 8px; text-align: right; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; border-bottom: 1px solid #e8e0d4;">Hours</th>
              <th style="padding: 10px 8px; text-align: right; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; border-bottom: 1px solid #e8e0d4;">Rate</th>
              <th style="padding: 10px 12px; text-align: right; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; border-bottom: 1px solid #e8e0d4;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHtml}
          </tbody>
        </table>

        <!-- Totals -->
        <table style="width: 280px; margin-left: auto; margin-top: 16px; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-size: 12px; color: #6b5e52;">Subtotal</td>
            <td style="padding: 6px 0; font-size: 12px; color: #3d2b1f; text-align: right; font-weight: 500;">${formatCurrency(Number(invoice.subtotal), invoice.currency)}</td>
          </tr>
          ${
            Number(invoice.tax_rate) > 0
              ? `<tr>
                  <td style="padding: 6px 0; font-size: 12px; color: #6b5e52;">Tax (${Number(invoice.tax_rate)}%)</td>
                  <td style="padding: 6px 0; font-size: 12px; color: #3d2b1f; text-align: right;">${formatCurrency(Number(invoice.tax_amount), invoice.currency)}</td>
                </tr>`
              : ""
          }
          <tr>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Total</td>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #c0704e; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(Number(invoice.total), invoice.currency)}</td>
          </tr>
        </table>

        ${
          invoice.notes
            ? `<!-- Notes -->
              <div style="margin-top: 24px; padding: 16px; background: #faf6f0; border-radius: 8px;">
                <div style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b5e52; margin-bottom: 4px;">Notes</div>
                <div style="font-size: 12px; color: #6b5e52; white-space: pre-line;">${invoice.notes}</div>
              </div>`
            : ""
        }
      </div>

      <!-- Footer -->
      <div style="padding: 16px 32px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">
          Sent by ${invoice.from_name} via MinuteFlow
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
