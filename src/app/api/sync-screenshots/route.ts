export const dynamic = "force-dynamic";

/**
 * DEPRECATED ROUTE — locked down 2026-06-10.
 *
 * Screenshot sync to Google Drive is handled by the standalone cron job
 * (run_sync_screenshots.sh -> sync_screenshots.py), which talks directly to
 * Supabase REST + the Drive API and does NOT call this route. The Chrome
 * extension uploads via /api/upload-screenshot, which also writes directly to
 * Drive at capture time.
 *
 * This route previously:
 *   - guarded POST with the SUPABASE_SERVICE_ROLE_KEY as a shared header secret
 *     (an anti-pattern: leaks the service role key into client/cron config), and
 *   - exposed an UNAUTHENTICATED GET that leaked the Drive folder id and the
 *     service-account email to anonymous callers.
 *
 * It has no remaining live caller, so both verbs now return 410 Gone.
 */
const goneResponse = () =>
  Response.json(
    {
      error: "Gone",
      detail:
        "This endpoint is deprecated. Screenshot sync runs via the cron job; uploads go through /api/upload-screenshot.",
    },
    { status: 410 }
  );

export async function POST() {
  return goneResponse();
}

export async function GET() {
  return goneResponse();
}
