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
 * POST /api/paystub/resend
 * Body: { snapshot_id }
 * Resends the paystub email from a saved snapshot. Does NOT create a new payment record.
 */
export async function POST(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Admin only
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!callerProfile || callerProfile.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { snapshot_id } = body;

  if (!snapshot_id) {
    return Response.json({ error: "snapshot_id is required" }, { status: 400 });
  }

  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch the snapshot
  const { data: snap, error: snapError } = await adminClient
    .from("paystub_snapshots")
    .select("*")
    .eq("id", snapshot_id)
    .single();

  if (snapError || !snap) {
    return Response.json({ error: "Snapshot not found" }, { status: 404 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({ error: "Resend API key not configured" }, { status: 500 });
  }

  // Rebuild the email HTML from snapshot data
  const html = buildResendEmail({
    vaName: snap.full_name as string,
    vaEmail: snap.email_sent_to as string,
    payPeriod: snap.pay_period_label as string,
    byDate: (snap.by_date ?? {}) as Record<string, number>,
    totalHours: (snap.total_hours_ms as number) / 3_600_000,
    payRate: snap.pay_rate as number,
    grossPay: snap.gross_pay as number,
    amountPaid: snap.amount_paid as number,
    paymentMethod: snap.payment_method as string | null,
    confirmationNumber: snap.confirmation_number as string | null,
    paymentDate: snap.payment_date as string | null,
    personalMessage: snap.personal_message as string | null,
    companyName: (snap.company_name as string) || "MinuteFlow",
    originalSentAt: snap.sent_at as string,
  });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Toni Colina <noreply@minuteflow.click>",
      to: [snap.email_sent_to],
      subject: `Your MinuteFlow Paystub — ${snap.pay_period_label} (Resent)`,
      html,
      open_tracking: true,
      click_tracking: true,
    }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.text();
    return Response.json({ error: `Failed to send email: ${err}` }, { status: 500 });
  }

  // Update snapshot with latest resend message ID
  try {
    const resendData = await resendRes.json() as { id?: string };
    if (resendData.id) {
      await adminClient
        .from("paystub_snapshots")
        .update({ resend_message_id: resendData.id })
        .eq("id", snapshot_id);
    }
  } catch { /* non-fatal */ }

  return Response.json({ success: true, sentTo: snap.email_sent_to });
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
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
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface ResendEmailData {
  vaName: string;
  vaEmail: string;
  payPeriod: string;
  byDate: Record<string, number>;
  totalHours: number;
  payRate: number;
  grossPay: number;
  amountPaid: number;
  paymentMethod: string | null;
  confirmationNumber: string | null;
  paymentDate: string | null;
  personalMessage: string | null;
  companyName: string;
  originalSentAt: string;
}

function buildResendEmail(data: ResendEmailData): string {
  const {
    vaName,
    payPeriod,
    byDate,
    totalHours,
    payRate,
    grossPay,
    amountPaid,
    paymentMethod,
    confirmationNumber,
    paymentDate,
    personalMessage,
    companyName,
    originalSentAt,
  } = data;

  const rowsHtml = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([date, ms]) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e8e0d4; color: #3d2b1f; font-size: 13px;">${formatDateLabel(date)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e8e0d4; color: #6b5e52; font-size: 13px; text-align: right;">${formatHours(ms)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e8e0d4; color: #6b5e52; font-size: 13px; text-align: right;">${formatCurrency((ms / 3_600_000) * payRate)}</td>
      </tr>`
    )
    .join("");

  const noRowsHtml = `
    <tr>
      <td colspan="3" style="padding: 20px 12px; text-align: center; color: #9e9080; font-size: 13px;">No time logged for this period.</td>
    </tr>`;

  const originalDate = new Date(originalSentAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">

    <!-- Resent banner -->
    <div style="background: #fef3cd; border: 1px solid #f5c542; border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; font-size: 12px; color: #7d5f00;">
      📤 This paystub was originally sent on ${originalDate} and has been resent at your request.
    </div>

    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">

      <!-- Header -->
      <div style="padding: 28px 32px; border-bottom: 1px solid #e8e0d4;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 4px;">${companyName}</div>
            <div style="font-size: 22px; font-weight: 700; color: #c0704e;">Paystub</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: #9e9080; margin-bottom: 2px;">Pay Period</div>
            <div style="font-size: 13px; font-weight: 600; color: #3d2b1f;">${payPeriod}</div>
          </div>
        </div>
      </div>

      <!-- VA Info -->
      <div style="padding: 20px 32px; background: #faf6f0; border-bottom: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; margin-bottom: 4px;">Prepared for</div>
        <div style="font-size: 16px; font-weight: 700; color: #3d2b1f;">${vaName}</div>
        <div style="font-size: 12px; color: #6b5e52; margin-top: 2px;">Rate: ${formatCurrency(payRate)}/hr</div>
      </div>

      <!-- Hours Breakdown -->
      <div style="padding: 24px 32px 0;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; margin-bottom: 12px;">Hours Breakdown</div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e8e0d4; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #faf6f0;">
              <th style="padding: 9px 12px; text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; border-bottom: 1px solid #e8e0d4;">Date</th>
              <th style="padding: 9px 12px; text-align: right; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; border-bottom: 1px solid #e8e0d4;">Hours</th>
              <th style="padding: 9px 12px; text-align: right; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; border-bottom: 1px solid #e8e0d4;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || noRowsHtml}
          </tbody>
        </table>
      </div>

      <!-- Totals -->
      <div style="padding: 20px 32px 28px;">
        <table style="width: 240px; margin-left: auto; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-size: 12px; color: #6b5e52;">Total Hours</td>
            <td style="padding: 6px 0; font-size: 12px; color: #3d2b1f; text-align: right; font-weight: 500;">${totalHours.toFixed(2)} hrs</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-size: 12px; color: #6b5e52;">Hourly Rate</td>
            <td style="padding: 6px 0; font-size: 12px; color: #3d2b1f; text-align: right; font-weight: 500;">${formatCurrency(payRate)}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0 6px; font-size: 14px; font-weight: 600; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Gross Pay</td>
            <td style="padding: 10px 0 6px; font-size: 14px; font-weight: 600; color: #3d2b1f; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(grossPay)}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Amount Paid</td>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #c0704e; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(amountPaid)}</td>
          </tr>
        </table>
      </div>

      ${personalMessage ? `
      <!-- Personal Message -->
      <div style="padding: 20px 32px; border-top: 1px solid #e8e0d4; background: #fdf9f5;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; margin-bottom: 8px;">Message</div>
        <p style="font-size: 13px; color: #3d2b1f; line-height: 1.6; margin: 0; font-style: italic;">"${personalMessage}"</p>
      </div>` : ""}

      ${paymentMethod ? `
      <!-- Payment Details -->
      <div style="padding: 20px 32px; border-top: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; margin-bottom: 12px;">Payment Details</div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 5px 0; font-size: 12px; color: #6b5e52; width: 140px;">Payment Method</td>
            <td style="padding: 5px 0; font-size: 12px; color: #3d2b1f; font-weight: 500;">${PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod}</td>
          </tr>
          ${paymentDate ? `<tr>
            <td style="padding: 5px 0; font-size: 12px; color: #6b5e52;">Payment Date</td>
            <td style="padding: 5px 0; font-size: 12px; color: #3d2b1f; font-weight: 500;">${formatDate(paymentDate)}</td>
          </tr>` : ""}
          ${confirmationNumber ? `<tr>
            <td style="padding: 5px 0; font-size: 12px; color: #6b5e52;">Confirmation #</td>
            <td style="padding: 5px 0; font-size: 12px; color: #3d2b1f; font-weight: 500;">${confirmationNumber}</td>
          </tr>` : ""}
        </table>
      </div>` : ""}

      <!-- Footer -->
      <div style="padding: 16px 32px; background: #faf6f0; border-top: 1px solid #e8e0d4; text-align: center;">
        <div style="font-size: 11px; color: #9e9080;">${companyName} · Powered by MinuteFlow · noreply@minuteflow.click</div>
      </div>

    </div>
  </div>
</body>
</html>`;
}
