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
    personal_message,
    custom_amount,
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

  // Fetch VA profile (include payment_accounts for display on paystub)
  const { data: vaProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("full_name, pay_rate, pay_rate_type, payment_accounts")
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

  // Fetch previous payments for this VA in the period (by payment_date)
  const { data: prevPaymentsRaw } = await adminClient
    .from("va_payments")
    .select("id, amount, payment_date, payment_method, notes, confirmation_number")
    .eq("va_id", user_id)
    .gte("payment_date", start_date)
    .lte("payment_date", end_date)
    .order("payment_date", { ascending: true });

  const previousPayments = (prevPaymentsRaw ?? []).map((p) => ({
    id: p.id as string,
    amount: Number(p.amount),
    payment_date: p.payment_date as string,
    payment_method: p.payment_method as string,
    notes: p.notes as string | null,
    confirmation_number: p.confirmation_number as string | null,
  }));
  const previousTotal = previousPayments.reduce((sum, p) => sum + p.amount, 0);

  // Preview mode — return numbers only (include payment_accounts so UI can show account details)
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
      paymentAccounts: (vaProfile.payment_accounts ?? {}) as Record<string, Record<string, string>>,
      previousPayments,
      previousTotal,
    });
  }

  // Send mode — save payment record FIRST, then send email.
  // Doing it in this order ensures the payment is always tracked,
  // even if the email fails for any reason.

  // Step 1: Record payment to va_payments
  // Use custom_amount if provided (Toni overrode the calculated amount), otherwise use grossPay
  const paymentAmount = custom_amount != null ? Number(custom_amount) : grossPay;

  let paymentRecorded = false;
  let paymentError: string | null = null;
  if (payment_method) {
    const { error: insertError } = await adminClient.from("va_payments").insert({
      va_id: user_id,
      amount: paymentAmount,
      payment_date: payment_date || new Date().toISOString().split("T")[0],
      payment_method,
      confirmation_number: confirmation_number ?? null,
      period_start: start_date,
      period_end: end_date,
      notes: `Paystub for ${periodLabel}`,
      personal_message: personal_message ?? null,
      recorded_by: user.id,
    });
    if (insertError) {
      console.error("va_payments insert error:", insertError.message);
      paymentError = insertError.message;
    } else {
      paymentRecorded = true;
    }
  }

  // Step 2: Send paystub email
  const resendKey = process.env.RESEND_API_KEY;
  let emailSent = false;
  let emailError: string | null = null;

  if (!resendKey) {
    emailError = "Resend API key not configured";
  } else {
    // Extract payment account details for the selected method
    const paymentAccounts = (vaProfile.payment_accounts ?? {}) as Record<string, Record<string, string>>;
    const accountDetails = payment_method ? (paymentAccounts[payment_method] ?? null) : null;

    const html = buildPaystubEmail({
      vaName: vaProfile.full_name,
      vaEmail,
      payPeriod: periodLabel,
      byDate,
      totalHours,
      payRate,
      grossPay,
      amountPaid: paymentAmount,
      previousPayments,
      previousTotal,
      paymentMethod: payment_method ?? null,
      confirmationNumber: confirmation_number ?? null,
      paymentDate: payment_date ?? null,
      personalMessage: personal_message ?? null,
      accountDetails,
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

    if (resendRes.ok) {
      emailSent = true;
    } else {
      const resendErr = await resendRes.text();
      emailError = `Failed to send email: ${resendErr}`;
      console.error("Resend error:", emailError);
    }
  }

  // If nothing worked at all, return an error
  if (!paymentRecorded && !emailSent) {
    return Response.json(
      { error: emailError || paymentError || "Both payment recording and email failed." },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    sentTo: vaEmail,
    totalHours,
    grossPay,
    payPeriod: periodLabel,
    paymentRecorded,
    paymentError,
    emailSent,
    emailError,
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

interface PreviousPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  notes: string | null;
  confirmation_number: string | null;
}

interface PaystubData {
  vaName: string;
  vaEmail: string;
  payPeriod: string;
  byDate: Record<string, number>;
  totalHours: number;
  payRate: number;
  grossPay: number;
  amountPaid: number;
  previousPayments: PreviousPayment[];
  previousTotal: number;
  paymentMethod: string | null;
  confirmationNumber: string | null;
  paymentDate: string | null;
  personalMessage: string | null;
  accountDetails: Record<string, string> | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  gcash: "Gcash",
  bank_deposit: "Bank Deposit",
  paypal: "Paypal",
  remittance: "Remittance",
};

function buildPaystubEmail(data: PaystubData): string {
  const { vaName, payPeriod, byDate, totalHours, payRate, grossPay, amountPaid, previousPayments, previousTotal, paymentMethod, confirmationNumber, paymentDate, personalMessage, accountDetails } = data;

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
            <td style="padding: 10px 0 6px; font-size: 14px; font-weight: 600; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Gross Pay</td>
            <td style="padding: 10px 0 6px; font-size: 14px; font-weight: 600; color: #3d2b1f; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(grossPay)}</td>
          </tr>
          ${previousTotal > 0 ? `<tr>
            <td style="padding: 6px 0; font-size: 12px; color: #9e9080;">Previous Payments</td>
            <td style="padding: 6px 0; font-size: 12px; color: #9e9080; text-align: right;">− ${formatCurrency(previousTotal)}</td>
          </tr>` : ""}
          <tr>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #3d2b1f; border-top: 2px solid #e8e0d4;">Amount Paid</td>
            <td style="padding: 10px 0 6px; font-size: 15px; font-weight: 700; color: #c0704e; text-align: right; border-top: 2px solid #e8e0d4;">${formatCurrency(amountPaid)}</td>
          </tr>
        </table>
      </div>

      ${previousPayments.length > 0 ? `
      <!-- Previous Payments -->
      <div style="padding: 20px 32px; border-top: 1px solid #e8e0d4;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9e9080; margin-bottom: 12px;">Previous Payments This Period</div>
        <table style="width: 100%; border-collapse: collapse;">
          ${previousPayments.map((p) => `<tr>
            <td style="padding: 5px 0; font-size: 12px; color: #6b5e52;">${formatDate(p.payment_date)} · ${PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
            <td style="padding: 5px 0; font-size: 12px; color: #3d2b1f; font-weight: 500; text-align: right;">${formatCurrency(p.amount)}</td>
          </tr>`).join("")}
        </table>
      </div>` : ""}

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
          ${accountDetails ? Object.entries(accountDetails).filter(([,v]) => v).map(([k, v]) => `<tr>
            <td style="padding: 5px 0; font-size: 12px; color: #6b5e52; text-transform: capitalize;">${k.replace(/_/g, " ")}</td>
            <td style="padding: 5px 0; font-size: 12px; color: #3d2b1f; font-weight: 500;">${v}</td>
          </tr>`).join("") : ""}
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
