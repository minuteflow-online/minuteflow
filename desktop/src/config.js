/**
 * MinuteFlow Desktop — Supabase config
 *
 * Same Supabase project + anon key already used by:
 *  - the web app (src/lib/supabase/client.ts, via NEXT_PUBLIC_SUPABASE_* env vars)
 *  - the browser extension (extension/supabase.js)
 *
 * The anon key is the standard public client key (gated by Supabase RLS on the
 * server), so it's safe to ship in client code the same way the extension does.
 * This file intentionally does not read from the web app's .env.local.
 */

module.exports = {
  SUPABASE_URL: "https://tdaurfsglbxoutvdybjm.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYXVyZnNnbGJ4b3V0dmR5YmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDUyMTQsImV4cCI6MjA4OTUyMTIxNH0.88v232bVlqCb1UjL6XJ3rFrPA7-qA0yVrxOJXLh0eZw",

  // Same base URL the browser extension targets (extension/background.js CONFIG.API_BASE).
  // Used only for the handful of Next.js API routes that don't have a direct-table
  // equivalent (assigned-tasks list + status PATCH) — see webApiClient.js.
  WEB_APP_BASE_URL: "https://minuteflow.click",
};
