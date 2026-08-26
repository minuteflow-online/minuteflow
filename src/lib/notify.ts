import { sendTelegram, telegramEnabled, esc } from "./telegram";
import { sendResendEmail } from "@/lib/sendEmail";

// Channel-agnostic admin notifications.
//
// Everything that alerts Toni (invoice review links, paystub reviews, send
// codes, reminders) goes through here so the delivery channel is swappable.
// It sends email via Resend, plus a Telegram copy to the financial chat when
// one is configured. To add SMS later, implement the adapter and route by
// NOTIFY_CHANNEL — callers don't change.

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
    const res = await sendResendEmail({
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
 * Notify Toni. Email goes out as before; a Telegram copy is sent too whenever
 * the financial chat is configured.
 *
 * These payloads are invoice and paystub alerts, so they route to the
 * "financial" topic — which never falls back to the shared team group, since
 * that group includes non-financial managers. Setting TELEGRAM_BUDGET_CHAT_ID
 * is the single switch that turns this on; with it unset, behaviour is
 * byte-for-byte what it was before.
 *
 * The email result stays the return value: callers already branch on it, and
 * a Telegram hiccup must not make a delivered email look failed.
 */
export async function notifyAdmin(payload: NotifyPayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  const channel = (process.env.NOTIFY_CHANNEL || "email").toLowerCase();

  if (telegramEnabled("financial")) {
    // text is the plain-text fallback the payload already carries for exactly
    // this purpose; esc() guards against a stray angle bracket in a client name.
    await sendTelegram(
      "financial",
      [`🧾 <b>${esc(payload.subject)}</b>`, "", esc(payload.text)].join("\n")
    );
  }

  switch (channel) {
    case "telegram":
      // Telegram already sent above; skip the email entirely.
      return { ok: telegramEnabled("financial") };
    case "email":
    default:
      return sendEmail(payload);
  }
}
