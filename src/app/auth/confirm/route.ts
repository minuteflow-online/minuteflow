import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * GET /auth/confirm
 * Handles Supabase password reset token verification.
 * Called after user clicks the reset link in their email.
 * Exchanges the token for a session and redirects to /update-password.
 *
 * IMPORTANT: Cookies must be set directly on the NextResponse object.
 * Using next/headers cookies() here doesn't carry cookies into the redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const errorRedirect = NextResponse.redirect(
    `${origin}/forgot-password?error=The+reset+link+is+invalid+or+has+expired.`
  );

  // PKCE flow: exchange code for session
  if (code) {
    const successResponse = NextResponse.redirect(`${origin}/update-password`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              successResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return successResponse;
    }
  }

  // Implicit flow: verify token hash
  if (token_hash && type) {
    const successResponse = NextResponse.redirect(`${origin}/update-password`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              successResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      return successResponse;
    }
  }

  // Something went wrong — send them back with an error
  return errorRedirect;
}
