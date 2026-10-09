import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Resend webhook signature (Svix-style HMAC-SHA256).
 * Resend signs webhooks with: HMAC-SHA256(svix_id + "." + svix_timestamp + "." + raw_body, secret_bytes)
 * The secret is base64-encoded (without the "whsec_" prefix).
 */
export function verifyResendSignature(
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
    const computed = Buffer.from(hmac.digest("base64"));

    // svixSignature may be a space-separated list of "v1,<base64>" entries
    const sigs = svixSignature.split(" ");
    return sigs.some((sig) => {
      const parts = sig.split(",");
      if (parts.length !== 2 || parts[0] !== "v1") return false;
      const given = Buffer.from(parts[1]);
      return given.length === computed.length && timingSafeEqual(given, computed);
    });
  } catch {
    return false;
  }
}

export type ResendWebhookCheck = { ok: true } | { ok: false; error: string };

/**
 * Decides whether a webhook request really came from Resend.
 *
 * A missing secret rejects every request. The check used to be skipped when
 * RESEND_WEBHOOK_SECRET was unset, so removing or renaming that variable would
 * have quietly opened the route to anyone.
 */
export function checkResendWebhook({
  rawBody,
  headers,
  secret,
  nowSeconds = Date.now() / 1000,
}: {
  rawBody: string;
  headers: Pick<Headers, "get">;
  secret: string | undefined;
  nowSeconds?: number;
}): ResendWebhookCheck {
  if (!secret) {
    return { ok: false, error: "Webhook secret is not configured" };
  }

  const svixId = headers.get("svix-id") || "";
  const svixTimestamp = headers.get("svix-timestamp") || "";
  const svixSignature = headers.get("svix-signature") || "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, error: "Missing webhook signature headers" };
  }

  // Reject if timestamp is older than 5 minutes
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(nowSeconds - ts) > 300) {
    return { ok: false, error: "Webhook timestamp too old" };
  }

  if (!verifyResendSignature(rawBody, svixId, svixTimestamp, svixSignature, secret)) {
    return { ok: false, error: "Invalid webhook signature" };
  }

  return { ok: true };
}
