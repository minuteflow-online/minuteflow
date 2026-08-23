import { createHmac, timingSafeEqual } from "node:crypto";

// Signing secret. Reuses the service-role key like approvalToken.ts does —
// server-only, never shipped to the client, and one fewer env var to manage.
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * The payload carried by a "connect your Telegram" deep link.
 *
 * Telegram caps a /start payload at 64 characters, which a raw UUID plus a
 * signature would blow past. So the UUID travels as its 16 raw bytes in
 * base64url (22 chars) followed by a 16-char HMAC over it — 38 in total.
 *
 * The signature is what makes this safe to hand out: without it, anyone could
 * guess a colleague's id and have their private notices delivered to their own
 * Telegram.
 */

const SIG_LENGTH = 16;

function sign(idB64: string): string {
  return createHmac("sha256", SECRET).update(`tglink:${idB64}`).digest("hex").slice(0, SIG_LENGTH);
}

function uuidToB64(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

function b64ToUuid(b64: string): string | null {
  try {
    const hex = Buffer.from(b64, "base64url").toString("hex");
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

/** Builds the payload for t.me/<bot>?start=<payload>. */
export function makeLinkPayload(userId: string): string {
  const idB64 = uuidToB64(userId);
  return `${idB64}${sign(idB64)}`;
}

/** Recovers the user id from a payload, or null if it is malformed or unsigned. */
export function parseLinkPayload(payload: string): string | null {
  if (!payload || payload.length <= SIG_LENGTH) return null;
  const idB64 = payload.slice(0, -SIG_LENGTH);
  const sig = payload.slice(-SIG_LENGTH);
  const expected = sign(idB64);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return b64ToUuid(idB64);
}
