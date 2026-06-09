/**
 * Google OAuth token management utilities.
 *
 * Stores the access_token and its expiry in _oauth_temp alongside the refresh_token.
 * All reads/writes go through Supabase service role.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/** Read a single key from _oauth_temp. Returns null if not found. */
async function readOauthKey(
  supabase: SupabaseClient,
  key: string
): Promise<string | null> {
  const { data } = await supabase
    .from("_oauth_temp")
    .select("value")
    .eq("key", key)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data as { value: string } | null)?.value ?? null;
}

/** Write (upsert) a key in _oauth_temp — deletes old row then inserts fresh. */
async function writeOauthKey(
  supabase: SupabaseClient,
  key: string,
  value: string
): Promise<void> {
  await supabase.from("_oauth_temp").delete().eq("key", key);
  await supabase.from("_oauth_temp").insert({ key, value });
}

export interface GoogleTokenResult {
  access_token: string;
  /** Unix timestamp (ms) when the token expires */
  expires_at: number;
}

/**
 * Refresh the Google access_token using the stored refresh_token.
 * Saves the new access_token + expiry back to _oauth_temp.
 * Throws if refresh fails (caller should surface this as an auth error).
 */
export async function refreshGoogleToken(): Promise<GoogleTokenResult> {
  const supabase = getSupabase();

  const refreshToken =
    (await readOauthKey(supabase, "GOOGLE_REFRESH_TOKEN")) ??
    process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("No Google refresh_token found — reauth required at /api/google-auth");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      `Google token refresh failed: ${data.error ?? res.status} — ${data.error_description ?? "unknown"}`
    );
  }

  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

  // Persist new access_token and expiry
  await writeOauthKey(supabase, "GOOGLE_ACCESS_TOKEN", data.access_token);
  await writeOauthKey(supabase, "GOOGLE_ACCESS_TOKEN_EXPIRY", String(expiresAt));

  console.log("[google-token] Access token refreshed. Expires at:", new Date(expiresAt).toISOString());

  return { access_token: data.access_token, expires_at: expiresAt };
}

/**
 * Get a valid access_token, auto-refreshing if the cached one is expired or missing.
 * Returns the access_token string.
 */
export async function getValidAccessToken(): Promise<string> {
  const supabase = getSupabase();

  const cachedToken = await readOauthKey(supabase, "GOOGLE_ACCESS_TOKEN");
  const cachedExpiry = await readOauthKey(supabase, "GOOGLE_ACCESS_TOKEN_EXPIRY");

  // Use cached token if it has at least 5 minutes left
  if (cachedToken && cachedExpiry) {
    const expiresAt = parseInt(cachedExpiry, 10);
    const fiveMinutes = 5 * 60 * 1000;
    if (!isNaN(expiresAt) && expiresAt - Date.now() > fiveMinutes) {
      return cachedToken;
    }
  }

  // Refresh
  const { access_token } = await refreshGoogleToken();
  return access_token;
}

/**
 * Build a google.auth.OAuth2 client pre-loaded with a valid access_token.
 * Uses lazy import so this module stays tree-shakeable in non-google contexts.
 */
export async function buildGoogleAuthClient() {
  const { google } = await import("googleapis");

  const accessToken = await getValidAccessToken();

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    "https://minuteflow.click/api/oauth-callback"
  );

  // Also provide the refresh_token so googleapis can auto-renew internally
  const supabase = getSupabase();
  const refreshToken =
    (await readOauthKey(supabase, "GOOGLE_REFRESH_TOKEN")) ??
    process.env.GOOGLE_REFRESH_TOKEN ??
    "";

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  // When googleapis auto-refreshes internally, persist the new token
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      const expiry = tokens.expiry_date ?? Date.now() + 3600 * 1000;
      const sb = getSupabase();
      await writeOauthKey(sb, "GOOGLE_ACCESS_TOKEN", tokens.access_token);
      await writeOauthKey(sb, "GOOGLE_ACCESS_TOKEN_EXPIRY", String(expiry));
      console.log("[google-token] googleapis auto-refreshed token, persisted.");
    }
  });

  return oauth2Client;
}
