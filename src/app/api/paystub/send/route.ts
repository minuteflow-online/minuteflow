import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/paystub/send
 * Body: { user_id, start_date, end_date, pay_period_label?, preview? }
 * If preview=true: returns calculation only, no email sent.
 * If preview=false (default): sends paystub email via Resend.
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
  const {
    user_id,
    start_date,
    end_date,
    pay_period_label,
    preview = false,
    payment_method,
    confirmation_number,
    payment_date,
  } = body;

  if (!user_id || !start_date || !end_date) {
    return Response.json(
      { error: "user_id, start_date, and end_date are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch VA profile
  const { data: vaProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("full_name, pay_rate, pay_rate_type")
    .eq("id", user_id)
    .single();

  if (profileError || !vaProfile) {
    return Response.json({ error: "VA not found" }, { status: 404 });
  }

  // Fetch VA email from auth
  const { data: authData } = await adminClient.auth.admin.getUserById(user_id);
  const vaEmail = authData?.user?.email;
  if (!vaEmail) {
    return Response.json({ error: "VA has no email on file" }, { status: 400 });
  }

  // Filter by session_date (local date) — same as Financial tab.
  // Using start_time UTC would miss early-morning PH entries whose UTC timestamp
  // falls on the previous calendar day.
  const { data: logs } = await adminClient
    .from("time_logs")
    .select("start_time, end_time, duration_ms, task_name, category, session_date")
    .eq("user_id", user_id)
    .gte("session_date", start_date)
    .lte("session_date", end_date)
    .order("start_time", { ascending: true });

  const entries = logs ?? [];

  // Group by session_date (local date) — matches Financial tab logic
  const byDate: Record<string, number> = {};
  let totalMs = 0;

  // Exclude Clock In / Clocked Out — these are session markers, not payable time
  const EXCLUDED_TASKS = ["Clock In", "Clocked Out"];

  for (const log of entries) {
    if (!log.duration_ms) continue;
    if (EXCLUDED_TASKS.includes(log.task_name)) continue;
    const ms = Number(log.duration_ms);
    // Use session_date (local date VA was working), fall back to UTC date
    const dateKey = (log.session_date as string) || (log.start_time as string).split("T")[0];
    byDate[dateKey] = (byDate[dateKey] || 0) + ms;
    totalMs += ms;
  }

  const totalHours = totalMs / 3_600_000;
  const payRate = Number(vaProfile.pay_rate) || 0;
  const grossPay = totalHours * payRate;
  const periodLabel =
    pay_period_label ||
    `${formatDate(start_date)} – ${formatDate(end_date)}`;

  // Preview mode — return numbers only
  if (preview) {
    return Response.json({
      preview: true,
      vaName: vaProfile.full_name,
      vaEmail,
      payPeriod: periodLabel,
      totalHours,
      payRate,
      grossPay,
      byDate,
    });
  }

  // Send mode — build and email the paystub
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({ error: "Resend API key not configured" }, { status: 500 });
  }

  const html = buildPaystubEmail({
    vaName: vaProfile.full_name,
    vaEmail,
    payPeriod: periodLabel,
    byDate,
    totalHours,
    payRate,
    grossPay,
    paymentMethod: payment_method ?? null,
    confirmationNumber: confirmation_number ?? null,
    paymentDate: payment_date ?? null,
  });

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MinuteFlow <noreply@minuteflow.click>",
      to: [vaEmail],
      subject: `Your MinuteFlow Paystub — ${periodLabel}`,
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

  // Save payment record to va_payments
  if (payment_method) {
    await adminClient.from("va_payments").insert({
      va_id: user_id,
      amount: grossPay,
      payment_date: payment_date || new Date().toISOString().split("T")[0],
      payment_method,
      confirmation_number: confirmation_number ?? null,
      period_start: start_date,
      period_end: end_date,
      notes: `Paystub for ${periodLabel}`,
      recorded_by: user.id,
    });
  }

  return Response.json({
    success: true,
    sentTo: vaEmail,
    totalHours,
    grossPay,
    payPeriod: periodLabel,
  });
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
  const h = ms / 3_600_000;
  return h.toFixed(2) + " hrs";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDateLabel(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/* ── Email HTML Builder ───────────────────────────────────── */

interface PaystubData {
  vaName: string;
  vaEmail: string;
  payPeriod: string;
  byDate: Record<string, number>;
  totalHours: number;
  payRate: number;
  grossPay: number;
  paymentMethod: string | null;
  confirmationNumber: string | null;
  paymentDate: string | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  gcash: "Gcash",
  bank_deposit: "Bank Deposit",
  paypal: "Paypal",
  remittance: "Remittance",
};

function buildPaystubEmail(data: PaystubData): string {
  const { vaName, payPeriod, byDate, totalHours, payRate, grossPay, paymentMethod, confirmationNumber, paymentDate } = data;

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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #faf6f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: #fff; border-radius: 12px; border: 1px solid #e8e0d4; overflow: hidden;">

      <!-- Header -->
      <div style="padding: 28px 32px; border-bottom: 1px solid #e8e0d4;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #9e9080; margin-bottom: 4px;">MinuteFlow</div>
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
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Gross Pay</td>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #c0704e; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(grossPay)}</td>
          </tr>
        </table>
      </div>

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
        <div style="font-size: 11px; color: #9e9080;">Generated by MinuteFlow · noreply@minuteflow.click</div>
      </div>

    </div>
  </div>
</body>
</html>`;
}
