import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://minuteflow.click/api/oauth-callback";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return new Response(
      html(`<h1>❌ Authorization Error</h1><p>${error}</p>`),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code) {
    return new Response(
      html(`<h1>❌ No code received</h1><p>Something went wrong with the authorization flow.</p>`),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.refresh_token) {
    return new Response(
      html(`<h1>❌ Token Exchange Failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Store refresh token in Supabase temp table for Manny to pick up
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from("_oauth_temp").insert({
    key: "GOOGLE_REFRESH_TOKEN",
    value: tokenData.refresh_token,
  });

  return new Response(
    html(`
      <h1>✅ Authorization Successful!</h1>
      <p>Google Drive access has been granted. Manny is now updating the system automatically.</p>
      <p>You can close this tab and return to MinuteFlow.</p>
      <p style="font-size:12px;color:#888;margin-top:40px;">This was a one-time authorization. Screenshots will resume uploading to Google Drive shortly.</p>
    `),
    { headers: { "Content-Type": "text/html" } }
  );
}

function html(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MinuteFlow - Google Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    h1 { font-size: 24px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow: auto; font-size: 12px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
