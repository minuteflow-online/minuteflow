import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

/**
 * Verify Resend webhook signature (Svix-style HMAC-SHA256).
 * Resend signs webhooks with: HMAC-SHA256(svix_id + "." + svix_timestamp + "." + raw_body, secret_bytes)
 * The secret is base64-encoded (without the "whsec_" prefix).
 */
function verifyResendSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  try {
    // The secret comes as "whsec_<base64>" from Resend dashboard
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
    const hmac = createHmac("sha256", secretBytes);
    hmac.update(toSign);
    const computed = hmac.digest("base64");

    // svixSignature may be comma-separated list of "v1,<base64>" entries
    const sigs = svixSignature.split(" ");
    return sigs.some((sig) => {
      const parts = sig.split(",");
      return parts.length === 2 && parts[0] === "v1" && parts[1] === computed;
    });
  } catch {
    return false;
  }
}

/**
 * POST /api/webhooks/resend
 * Receives open/click events from Resend and stores them in email_events.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // Verify signature if secret is configured
  if (RESEND_WEBHOOK_SECRET) {
    const svixId = request.headers.get("svix-id") || "";
    const svixTimestamp = request.headers.get("svix-timestamp") || "";
    const svixSignature = request.headers.get("svix-signature") || "";

    if (!svixId || !svixTimestamp || !svixSignature) {
      return Response.json({ error: "Missing webhook signature headers" }, { status: 401 });
    }

    // Reject if timestamp is older than 5 minutes
    const ts = parseInt(svixTimestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return Response.json({ error: "Webhook timestamp too old" }, { status: 401 });
    }

    const valid = verifyResendSignature(rawBody, svixId, svixTimestamp, svixSignature, RESEND_WEBHOOK_SECRET);
    if (!valid) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
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
        <p style="margin:0 0 12px;"><strong>${recipientEmail ?? "Someone"}</strong> just <strong>${actionLabel}</strong> a MinuteFlow <strong>${typeLabel}</strong> email.</p>
        ${referenceId ? `<p style="margin:0 0 12px; color:#666; font-size:13px;">Reference ID: ${referenceId}</p>` : ""}
        <p style="margin:0; color:#999; font-size:12px;">MinuteFlow notification</p>
      </div>`;
    fetch("https://api.resend.com/emails", {
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
    }).catch(() => {/* non-fatal */});
  }

  return Response.json({ ok: true });
}
