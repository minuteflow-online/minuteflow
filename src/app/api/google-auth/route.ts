import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://minuteflow.click/api/oauth-callback";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * GET /api/google-auth
 * Redirects to Google's OAuth consent screen.
 * After authorization, Google redirects to /api/oauth-callback which stores the refresh token.
 */
export async function GET(_request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return Response.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return Response.redirect(authUrl);
}
