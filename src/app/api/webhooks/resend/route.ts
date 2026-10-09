import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { sendResendEmail } from "@/lib/sendEmail";
import { esc } from "@/lib/approvalPages";
import { checkResendWebhook } from "@/lib/resendWebhook";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/resend
 * Receives open/click events from Resend and stores them in email_events.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // A missing secret rejects the request too: skipping the check when it was
  // unset would have opened this route to anyone if the variable went missing.
  if (!RESEND_WEBHOOK_SECRET) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET is not set — rejecting the request.");
  }
  const verdict = checkResendWebhook({ rawBody, headers: request.headers, secret: RESEND_WEBHOOK_SECRET });
  if (!verdict.ok) {
    return Response.json({ error: verdict.error }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.type as string;
  if (!eventType) {
    return Response.json({ error: "Missing event type" }, { status: 400 });
  }

  // Only process open and click events
  if (eventType !== "email.opened" && eventType !== "email.clicked") {
    return Response.json({ ok: true, skipped: true });
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const resendMessageId = data.email_id as string | undefined;
  const recipientEmail = data.to as string | undefined;

  if (!resendMessageId) {
    return Response.json({ error: "Missing email_id in payload" }, { status: 400 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Determine which email type this belongs to by looking up the resend_message_id
  // in each tracked table. First match wins.
  let emailType: string | null = null;
  let referenceId: string | null = null;

  const [inviteResult, paystubResult, invoiceResult, broadcastResult] = await Promise.all([
    adminClient.from("invitations").select("id").eq("resend_message_id", resendMessageId).limit(1).single(),
    adminClient.from("paystub_snapshots").select("id").eq("resend_message_id", resendMessageId).limit(1).single(),
    adminClient.from("invoices").select("id").eq("resend_message_id", resendMessageId).limit(1).single(),
    adminClient.from("broadcasts").select("id").eq("resend_message_id", resendMessageId).limit(1).single(),
  ]);

  if (inviteResult.data) {
    emailType = "invite";
    referenceId = inviteResult.data.id as string;
  } else if (paystubResult.data) {
    emailType = "paystub";
    referenceId = paystubResult.data.id as string;
  } else if (invoiceResult.data) {
    emailType = "invoice";
    referenceId = invoiceResult.data.id as string;
  } else if (broadcastResult.data) {
    emailType = "broadcast";
    referenceId = broadcastResult.data.id as string;
  }

  // Insert event record
  const { error: insertError } = await adminClient.from("email_events").insert({
    resend_message_id: resendMessageId,
    event_type: eventType,
    email_type: emailType,
    reference_id: referenceId,
    recipient_email: recipientEmail ?? null,
    raw: payload,
  });

  if (insertError) {
    console.error("email_events insert error:", insertError.message);
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  // Notify Toni when an email is opened or clicked (fire-and-forget)
  if (process.env.RESEND_API_KEY) {
    const actionLabel = eventType === "email.opened" ? "opened" : "clicked a link in";
    const typeLabel = emailType ?? "email";
    const subject = `📬 ${recipientEmail ?? "A recipient"} ${actionLabel} your ${typeLabel}`;
    const html = `
      <div style="font-family:sans-serif; font-size:15px; color:#333; max-width:480px; margin:0 auto; padding:24px;">
        <p style="margin:0 0 12px;"><strong>${esc(recipientEmail ?? "Someone")}</strong> just <strong>${actionLabel}</strong> a MinuteFlow <strong>${esc(typeLabel)}</strong> email.</p>
        ${referenceId ? `<p style="margin:0 0 12px; color:#666; font-size:13px;">Reference ID: ${esc(referenceId)}</p>` : ""}
        <p style="margin:0; color:#999; font-size:12px;">MinuteFlow notification</p>
      </div>`;
    // after() keeps the function alive until the send finishes; started and
    // left, it can be cut off once the reply goes out.
    after(async () => {
      try {
        const res = await sendResendEmail({
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "MinuteFlow <noreply@minuteflow.click>",
            to: ["minuteflow.online@gmail.com"],
            subject,
            html,
          }),
        });
        if (!res.ok) console.error(`[resend webhook] open/click alert was not sent (${res.status})`);
      } catch (err) {
        console.error("[resend webhook] open/click alert failed", err);
      }
    });
  }

  return Response.json({ ok: true });
}
