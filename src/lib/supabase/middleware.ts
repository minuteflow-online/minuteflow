import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  CLIENT_ACCOUNT_TYPE,
  bearerAccountType,
  isClientAllowedApi,
} from "@/lib/clientApiGuard";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not add logic between createServerClient and
  // supabase.auth.getUser(). A token refresh could fail silently,
  // causing the user to appear logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/register") &&
    !request.nextUrl.pathname.startsWith("/signup-client") &&
    !request.nextUrl.pathname.startsWith("/forgot-password") &&
    !request.nextUrl.pathname.startsWith("/update-password") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/invite") &&
    !request.nextUrl.pathname.startsWith("/install") &&
    !request.nextUrl.pathname.startsWith("/ext-submit") &&
    !request.nextUrl.pathname.startsWith("/extension-privacy") &&
    !request.nextUrl.pathname.endsWith(".zip") &&
    !request.nextUrl.pathname.endsWith(".exe") &&
    !request.nextUrl.pathname.startsWith("/MinuteFlow") &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/task-list-preview")
  ) {
    // Redirect unauthenticated users to login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Client (employer) accounts may only reach the /api routes their own
  // pages use — see clientApiGuard.ts. Checked for the cookie session and
  // for a bearer token, since several routes accept either.
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) {
    const isClient =
      user?.app_metadata?.account_type === CLIENT_ACCOUNT_TYPE ||
      bearerAccountType(request.headers.get("authorization")) === CLIENT_ACCOUNT_TYPE;
    if (isClient && !isClientAllowedApi(pathname, request.method)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return supabaseResponse;
}
