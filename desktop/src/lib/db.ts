// Thin PostgREST + Supabase Auth client, ported from the Chrome extension's
// extension/supabase.js. Reads and writes go straight to Supabase with the
// signed-in user's own JWT, so Postgres RLS enforces exactly the same access
// a VA gets from the web app's client-side Supabase calls (SessionContext,
// the dashboard's clockIn/clockOut, AssignedTasksWidget's VA query path).
//
// Deliberately does NOT go through minuteflow.click's Next.js API routes for
// reads/writes here: those routes authenticate via the cookie-based
// @supabase/ssr session (src/lib/supabase/server.ts), which this desktop app
// — not a tab of that site — never has. Where a route has no such gate
// (upload-screenshot), this app calls it directly instead; see screenshot.ts.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
  user: { id: string; email?: string };
}

let cached: AuthSession | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const stored = (await window.mfDesktop.auth.load()) as AuthSession | null;
  if (stored) cached = stored;
}

export async function getSession(): Promise<AuthSession | null> {
  await ensureLoaded();
  return cached;
}

async function setSession(session: AuthSession): Promise<void> {
  cached = session;
  await window.mfDesktop.auth.save(session);
}

export async function clearSession(): Promise<void> {
  cached = null;
  loaded = true;
  await window.mfDesktop.auth.clear();
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as Record<string, string>);
    throw new Error(err.error_description || err.msg || `Login failed (${res.status})`);
  }

  const data = await res.json();
  const session: AuthSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    user: data.user,
  };
  await setSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
    } catch {
      // Best-effort — clear locally regardless.
    }
  }
  await clearSession();
}

async function refreshToken(): Promise<AuthSession | null> {
  const session = await getSession();
  if (!session?.refresh_token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await clearSession();
    return null;
  }

  const data = await res.json();
  const next: AuthSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    user: data.user,
  };
  await setSession(next);
  return next;
}

/** Ensures a valid access token, refreshing when it's within 60s of expiry. */
export async function ensureAuth(): Promise<AuthSession | null> {
  let session = await getSession();
  if (!session) return null;
  if (session.expires_at && Date.now() > session.expires_at - 60000) {
    session = await refreshToken();
  }
  return session;
}

interface QueryOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Raw PostgREST query string, e.g. "user_id=eq.123&select=*". */
  filters?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class PostgrestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** PostgREST request against a table, authenticated as the signed-in user (RLS-scoped). */
export async function query<T = unknown>(
  table: string,
  { method = "GET", filters = "", body, headers: extraHeaders = {} }: QueryOptions = {}
): Promise<T> {
  const session = await ensureAuth();
  if (!session) throw new Error("Not authenticated");

  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (method === "POST" && !headers["Prefer"]) headers["Prefer"] = "return=representation";
  if (method === "PATCH" && !headers["Prefer"]) headers["Prefer"] = "return=representation";

  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);

  const url = `${SUPABASE_URL}/rest/v1/${table}${filters ? `?${filters}` : ""}`;
  const res = await fetch(url, init);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as Record<string, string>);
    throw new PostgrestError(err.message || `Query failed: ${res.status}`, err.code);
  }
  if (res.status === 204) return null as T;
  return res.json();
}
