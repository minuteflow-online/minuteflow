import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * @param bearerToken  Optional raw access token (no "Bearer " prefix). When
 *   given, the returned client's `.from()`/`.storage` calls carry it as the
 *   Authorization header, so they run under that user's RLS instead of the
 *   cookie session. Route handlers that accept it should also pass it to
 *   `supabase.auth.getUser(bearerToken)` — the auth client resolves the user
 *   from its stored (cookie) session unless a token is passed explicitly, it
 *   does NOT fall back to this header. This is for callers with no browser
 *   cookies to present (e.g. the desktop app, which signs in directly against
 *   Supabase Auth) — omitted, behavior is byte-for-byte the same as before.
 */
export async function createClient(bearerToken?: string) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component where
            // cookies cannot be set. This can be ignored if the middleware
            // (proxy) refreshes the user session.
          }
        },
      },
      ...(bearerToken ? { global: { headers: { Authorization: `Bearer ${bearerToken}` } } } : {}),
    }
  );
}
