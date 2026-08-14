import { createHmac, timingSafeEqual } from "node:crypto";

// Signing secret for email approve/decline links. We reuse the service-role key
// (server-only, never shipped to the client) rather than add another env var.
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// A short, unguessable HMAC over kind:id:action. Because it's derived from a
// server secret, a recipient can act from the link without logging in, but the
// link can't be forged or guessed. Regenerating with the same inputs always
// yields the same token, so the action route can re-derive and compare.
export function makeApprovalToken(kind: string, id: string | number, action: string): string {
  return createHmac("sha256", SECRET).update(`${kind}:${id}:${action}`).digest("hex").slice(0, 32);
}

export function verifyApprovalToken(kind: string, id: string | number, action: string, token: string): boolean {
  const expected = makeApprovalToken(kind, id, action);
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
