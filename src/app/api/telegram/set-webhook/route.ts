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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, username, role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    // Says who the server thinks you are. A bare "Forbidden" on an account
    // that plainly holds the role sends you hunting through RLS and deploy
    // logs, when the usual answer is that this browser is signed in as
    // somebody else — or as a client, via the login-as feature.
    return {
      error: Response.json(
        {
          error: "Forbidden",
          signedInAs: profile?.full_name ?? profile?.username ?? "(no profile row found)",
          role: profile?.role ?? null,
          department: profile?.department ?? null,
          lookupError: profileError?.message ?? null,
        },
        { status: 403 }
      ),
    };
  }
  return {};
}

/**
 * GET — what Telegram thinks the webhook is.
 *
 * Added after a reply in the finance chat produced no POST here at all, with
 * no way to tell whether the webhook was unregistered, pointing somewhere
 * else, or failing on Telegram's side. getWebhookInfo answers all three, and
 * a browser link answers it without anyone handling the bot token.
 *
 * Read-only, and the token is deliberately not echoed back.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 400 });

  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: Record<string, unknown>;
    description?: string;
  };
  if (!json.ok) {
    return Response.json({ error: json.description ?? "Telegram rejected the request" }, { status: 502 });
  }

  const info = json.result ?? {};
  return Response.json({
    registered: Boolean(info.url),
    matchesExpected: info.url === WEBHOOK_URL,
    expected: WEBHOOK_URL,
    url: info.url ?? null,
    hasSecret: Boolean(info.has_custom_certificate) || undefined,
    pendingUpdates: info.pending_update_count ?? 0,
    allowedUpdates: info.allowed_updates ?? "(all)",
    lastErrorDate: info.last_error_date
      ? new Date(Number(info.last_error_date) * 1000).toISOString()
      : null,
    lastErrorMessage: info.last_error_message ?? null,
  });
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
