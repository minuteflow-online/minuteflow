import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

const WEBHOOK_URL = "https://minuteflow.click/api/telegram/webhook";

/**
 * Registers (or clears) the inbound webhook with Telegram.
 *
 * Exists so nobody has to paste a bot token into a terminal to call
 * setWebhook by hand — the token stays in the server environment, same
 * reasoning as the chat-id page.
 *
 * Registering a webhook turns getUpdates off, which is what the chat-id page
 * reads. That page already reports a registered webhook for exactly this
 * reason; DELETE here puts things back if the manual listing is needed again.
 */

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return {};
}

export async function POST() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token) return Response.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 400 });
  if (!secret) {
    return Response.json(
      { error: "TELEGRAM_WEBHOOK_SECRET is not set. Add it in Vercel and redeploy first." },
      { status: 400 }
    );
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      secret_token: secret,
      // Only what the webhook acts on. Asking for everything would have
      // Telegram post every edit and reaction at us for nothing.
      allowed_updates: ["message"],
      // Kept, not dropped. People are told to message the bot before the
      // webhook is switched on, so the queue holds exactly the /starts we most
      // want — discarding it would silently lose everyone who acted promptly.
      drop_pending_updates: false,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    return Response.json({ error: json.description ?? "Telegram rejected the request" }, { status: 502 });
  }
  return Response.json({ ok: true, url: WEBHOOK_URL });
}

/** Unregisters it, which switches getUpdates back on. */
export async function DELETE() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 400 });

  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    return Response.json({ error: json.description ?? "Telegram rejected the request" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
