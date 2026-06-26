import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  gcash: "Gcash",
  bank_deposit: "Bank Deposit",
  paypal: "Paypal",
  remittance: "Remittance",
};

/**
 * GET /api/paystub/print?id=xxx
 * Returns a print-optimized HTML page for the given paystub snapshot.
 * Open in a new tab → user can print or save as PDF.
 */
export async function GET(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("id is required", { status: 400 });
  }

  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: snap, error } = await adminClient
    .from("paystub_snapshots")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !snap) {
    return new Response("Paystub not found", { status: 404 });
  }

  // Scope check: admins see all; VAs may only print their own paystubs
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!callerProfile || (callerProfile.role !== "admin" && snap.user_id !== user.id)) {
    return new Response("Forbidden", { status: 403 });
  }

  const byDate = (snap.by_date ?? {}) as Record<string, number>;
  const totalHours = (snap.total_hours_ms as number) / 3_600_000;
  const payRate = snap.pay_rate as number;
  const grossPay = snap.gross_pay as number;
  const amountPaid = snap.amount_paid as number;
  const remainingBalance = grossPay - amountPaid;

  const rowsHtml = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ms]) => `
      <tr>
        <td>${formatDateLabel(date)}</td>
        <td class="text-right">${formatHours(ms)}</td>
        <td class="text-right">${formatCurrency((ms / 3_600_000) * payRate)}</td>
      </tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paystub — ${snap.full_name} — ${snap.pay_period_label}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #faf6f0;
      color: #3d2b1f;
      padding: 24px;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding: 12px 16px;
      background: #fff;
      border: 1px solid #e8e0d4;
      border-radius: 10px;
    }

    .toolbar h1 {
      font-size: 14px;
      font-weight: 600;
      color: #3d2b1f;
      flex: 1;
    }

    .btn-print {
      padding: 8px 18px;
      background: #c0704e;
      color: #fff;
      border: none;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-print:hover { background: #a85f3f; }

    .card {
      max-width: 640px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #e8e0d4;
      border-radius: 12px;
      overflow: hidden;
    }

    .card-header {
      padding: 24px 28px;
      border-bottom: 1px solid #e8e0d4;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .company-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #9e9080;
      margin-bottom: 4px;
    }

    .paystub-title {
      font-size: 22px;
      font-weight: 700;
      color: #c0704e;
    }

    .period-label {
      font-size: 11px;
      color: #9e9080;
      margin-bottom: 2px;
      text-align: right;
    }

    .period-value {
      font-size: 13px;
      font-weight: 600;
      color: #3d2b1f;
      text-align: right;
    }

    .va-section {
      padding: 18px 28px;
      background: #faf6f0;
      border-bottom: 1px solid #e8e0d4;
    }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9e9080;
      margin-bottom: 4px;
    }

    .va-name {
      font-size: 16px;
      font-weight: 700;
      color: #3d2b1f;
    }

    .va-rate {
      font-size: 12px;
      color: #6b5e52;
      margin-top: 2px;
    }

    .breakdown-section {
      padding: 20px 28px 0;
    }

    table.breakdown {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #e8e0d4;
      border-radius: 8px;
      overflow: hidden;
      margin-top: 10px;
      font-size: 13px;
    }

    table.breakdown th {
      padding: 8px 10px;
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9e9080;
      background: #faf6f0;
      border-bottom: 1px solid #e8e0d4;
    }

    table.breakdown td {
      padding: 9px 10px;
      border-bottom: 1px solid #e8e0d4;
      color: #3d2b1f;
    }

    .text-right { text-align: right; }

    .totals-section {
      padding: 18px 28px 24px;
    }

    table.totals {
      width: 240px;
      margin-left: auto;
      border-collapse: collapse;
      font-size: 13px;
    }

    table.totals td {
      padding: 5px 0;
      color: #6b5e52;
    }

    table.totals td:last-child {
      text-align: right;
      font-weight: 500;
      color: #3d2b1f;
    }

    .total-row td {
      padding-top: 10px;
      padding-bottom: 6px;
      border-top: 2px solid #e8e0d4;
      font-size: 14px;
      font-weight: 600;
      color: #3d2b1f;
    }

    .amount-paid-row td {
      padding-top: 10px;
      padding-bottom: 6px;
      border-top: 2px solid #e8e0d4;
      font-size: 15px;
      font-weight: 700;
    }

    .amount-paid-row td:last-child {
      color: #c0704e;
    }

    .details-section {
      padding: 16px 28px;
      border-top: 1px solid #e8e0d4;
    }

    .details-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #6b5e52;
      padding: 4px 0;
    }

    .details-row span:last-child {
      font-weight: 500;
      color: #3d2b1f;
    }

    .message-section {
      padding: 16px 28px;
      border-top: 1px solid #e8e0d4;
      background: #fdf9f5;
    }

    .message-text {
      font-size: 13px;
      color: #3d2b1f;
      font-style: italic;
      line-height: 1.6;
      margin-top: 6px;
    }

    .card-footer {
      padding: 14px 28px;
      border-top: 1px solid #e8e0d4;
      background: #faf6f0;
      text-align: center;
      font-size: 11px;
      color: #9e9080;
    }

    @media print {
      body { background: white; padding: 0; }
      .toolbar { display: none; }
      .card { border: none; border-radius: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Paystub: ${snap.full_name as string} — ${snap.pay_period_label as string}</h1>
    <button class="btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>

  <div class="card">
    <div class="card-header">
      <div>
        <div class="company-label">${(snap.company_name as string) || "MinuteFlow"}</div>
        <div class="paystub-title">Paystub</div>
      </div>
      <div>
        <div class="period-label">Pay Period</div>
        <div class="period-value">${snap.pay_period_label as string}</div>
      </div>
    </div>

    <div class="va-section">
      <div class="section-label">Prepared for</div>
      <div class="va-name">${snap.full_name as string}</div>
      <div class="va-rate">Rate: ${formatCurrency(payRate)}/hr</div>
    </div>

    <div class="breakdown-section">
      <div class="section-label">Hours Breakdown</div>
      <table class="breakdown">
        <thead>
          <tr>
            <th>Date</th>
            <th class="text-right">Hours</th>
            <th class="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="3" style="text-align:center;color:#9e9080;padding:16px;">No time logged for this period.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="totals-section">
      <table class="totals">
        <tr>
          <td>Total Hours</td>
          <td>${totalHours.toFixed(2)} hrs</td>
        </tr>
        <tr>
          <td>Hourly Rate</td>
          <td>${formatCurrency(payRate)}</td>
        </tr>
        <tr class="total-row">
          <td>Gross Pay</td>
          <td>${formatCurrency(grossPay)}</td>
        </tr>
        <tr class="amount-paid-row">
          <td>Amount Paid</td>
          <td>${formatCurrency(amountPaid)}</td>
        </tr>
        ${remainingBalance > 0.005 ? `<tr>
          <td style="color:#6b5e52;font-size:12px;">Remaining Balance</td>
          <td style="color:#6b5e52;font-size:12px;">${formatCurrency(remainingBalance)}</td>
        </tr>` : ""}
      </table>
    </div>

    ${snap.payment_method ? `
    <div class="details-section">
      <div class="section-label">Payment Details</div>
      <div class="details-row"><span>Method</span><span>${PAYMENT_METHOD_LABELS[snap.payment_method as string] ?? snap.payment_method}</span></div>
      ${snap.payment_date ? `<div class="details-row"><span>Payment Date</span><span>${formatDate(snap.payment_date as string)}</span></div>` : ""}
      ${snap.confirmation_number ? `<div class="details-row"><span>Confirmation #</span><span>${snap.confirmation_number}</span></div>` : ""}
    </div>` : ""}

    ${snap.personal_message ? `
    <div class="message-section">
      <div class="section-label">Message</div>
      <div class="message-text">"${snap.personal_message}"</div>
    </div>` : ""}

    <div class="card-footer">
      ${(snap.company_name as string) || "MinuteFlow"} · Powered by MinuteFlow · Sent ${new Date(snap.sent_at as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function formatHours(ms: number): string {
  return (ms / 3_600_000).toFixed(2) + " hrs";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDateLabel(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}
