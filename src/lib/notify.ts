// Channel-agnostic admin notifications.
//
// Everything that alerts Toni (invoice review links, paystub reviews, send
// codes, reminders) goes through here so the delivery channel is swappable.
// Today it sends email via Resend. To add Telegram or SMS later, implement the
// adapter and route by NOTIFY_CHANNEL — callers don't change.

type NotifyPayload = {
  /** Email recipient (used by the email adapter). */
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback / body for non-HTML channels (Telegram, SMS). */
  text: string;
  /** Display name for the email "from". */
  fromName?: string;
};

/** Send an email via Resend. Returns the provider message id when available. */
async function sendEmail(payload: NotifyPayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${payload.fromName || "MinuteFlow"} <noreply@minuteflow.click>`,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
      }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    let id: string | undefined;
    try { id = ((await res.json()) as { id?: string }).id; } catch { /* non-fatal */ }
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Notify Toni. Channel is chosen by NOTIFY_CHANNEL (default "email").
 * Future channels ("telegram", "sms") slot in here without touching callers.
 */
export async function notifyAdmin(payload: NotifyPayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  const channel = (process.env.NOTIFY_CHANNEL || "email").toLowerCase();
  switch (channel) {
    case "email":
    default:
      return sendEmail(payload);
  }
}
