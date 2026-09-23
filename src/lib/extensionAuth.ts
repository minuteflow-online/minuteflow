import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Verifies the Chrome extension's own logged-in session, if it sent one as a
 * Bearer token, and returns the real user id behind it.
 *
 * Returns null for a missing or invalid token rather than throwing — these
 * routes are called by the extension with no session cookie available, and
 * older/not-yet-updated installs don't send a token at all yet. Callers
 * currently fall back to trusting the request body's own userId when this
 * returns null (a pre-existing, more permissive behavior); once the whole
 * fleet is confirmed on a manifest version that sends this token (check
 * /api/extension-status), that fallback should be removed so a missing/
 * invalid token is rejected outright instead.
 */
export async function verifyExtensionToken(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
