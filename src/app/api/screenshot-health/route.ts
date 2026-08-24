/**
 * GET /api/screenshot-health
 *
 * Vercel cron target (every 3 hours).
 * - Verifies the Google OAuth token is valid by doing a lightweight Drive files.list
 * - Auto-refreshes the token if it's expired or about to expire
 * - If refresh fails, sends an alert email to minuteflow.online@gmail.com via Resend
 * - Returns a JSON health report
 *
 * Also callable manually; no cron secret required for read-only health check.
 * When called by Vercel cron the Authorization header will be Bearer <CRON_SECRET>.
 */

import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { refreshGoogleToken, getValidAccessToken } from "@/lib/google-token";
import { telegramEnabled, esc } from "@/lib/telegram";
import { notifyVaPrivately } from "@/lib/vaNotify";
import { EXTENSION_LATEST_VERSION, EXTENSION_STORE_URL, isVersionOlder } from "@/lib/extensionVersion";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALERT_EMAIL = "minuteflow.online@gmail.com";
const REAUTH_URL = "https://minuteflow.click/api/google-auth";

async function sendAlertEmail(errorMessage: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[screenshot-health] RESEND_API_KEY not set — cannot send alert email");
    return;
  }

  const body = {
    from: "MinuteFlow <noreply@minuteflow.click>",
    to: [ALERT_EMAIL],
    subject: "MinuteFlow Screenshot Auth Failed — manual reauth needed",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; max-width:600px; margin:0 auto; padding:24px;">
        <h2 style="color:#c0392b;">Screenshot Upload Auth Failure</h2>
        <p>The Google OAuth token for MinuteFlow screenshot uploads has expired and automatic refresh failed.</p>

        <div style="background:#fdf3f2; border:1px solid #f5c6c2; border-radius:8px; padding:16px; margin:16px 0;">
          <strong>Error:</strong><br/>
          <code style="font-size:12px; color:#7b1e1e;">${errorMessage}</code>
        </div>

        <p><strong>Action required:</strong> Please re-authorize Google Drive access by visiting:</p>
        <p>
          <a href="${REAUTH_URL}" style="display:inline-block; background:#2d3a4a; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:700;">
            Reauthorize Google Drive →
          </a>
        </p>
        <p style="font-size:12px; color:#888; margin-top:24px;">
          Sent by MinuteFlow screenshot health monitor at ${new Date().toISOString()}
        </p>
      </div>
    `,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[screenshot-health] Failed to send alert email:", text);
  } else {
    console.log("[screenshot-health] Alert email sent to", ALERT_EMAIL);
  }
}

export async function GET(request: NextRequest) {
  const startedAt = new Date().toISOString();

  // Allow unauthenticated health checks; cron calls will have the Authorization header
  // but we don't gate on it — the endpoint is read-only and non-destructive.
  const isCron = request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── 1. Check token validity ───────────────────────────────
  let tokenStatus: "valid" | "refreshed" | "failed" = "valid";
  let tokenError: string | null = null;
  let driveCheckOk = false;

  try {
    // getValidAccessToken auto-refreshes if needed
    const accessToken = await getValidAccessToken();

    // ── 2. Lightweight Drive check — list root, limit 1 ──────
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      "https://minuteflow.click/api/oauth-callback"
    );

    // Fetch refresh_token too so googleapis can re-auth if needed
    const { data: rtRow } = await supabase
      .from("_oauth_temp")
      .select("value")
      .eq("key", "GOOGLE_REFRESH_TOKEN")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const refreshToken =
      (rtRow as { value: string } | null)?.value ?? process.env.GOOGLE_REFRESH_TOKEN ?? "";

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    await drive.files.list({ pageSize: 1, fields: "files(id)" });
    driveCheckOk = true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("[screenshot-health] Initial token check failed, attempting refresh:", errMsg);

    // Token expired or invalid — force refresh
    try {
      await refreshGoogleToken();
      tokenStatus = "refreshed";
      driveCheckOk = true;
      console.log("[screenshot-health] Token refreshed successfully during health check.");
    } catch (refreshErr) {
      const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      tokenStatus = "failed";
      tokenError = refreshMsg;
      console.error("[screenshot-health] Token refresh failed:", refreshMsg);

      // Only send the alert email when running as a cron job (not on ad-hoc GET requests)
      if (isCron) {
        await sendAlertEmail(refreshMsg);
      }
    }
  }

  // ── 3. Recent upload stats ────────────────────────────────
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentUploads } = await supabase
    .from("task_screenshots")
    .select("id", { count: "exact", head: true })
    .gte("created_at", oneHourAgo);

  const { data: lastUpload } = await supabase
    .from("task_screenshots")
    .select("created_at, drive_file_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const report = {
    status: tokenStatus === "failed" ? "unhealthy" : "healthy",
    checkedAt: startedAt,
    token: {
      status: tokenStatus,
      ...(tokenError ? { error: tokenError } : {}),
    },
    driveCheck: driveCheckOk,
    recentUploads: recentUploads ?? 0,
    lastUpload: lastUpload
      ? { at: (lastUpload as { created_at: string; drive_file_id: string }).created_at, driveFileId: (lastUpload as { created_at: string; drive_file_id: string }).drive_file_id }
      : null,
    alertSent: tokenStatus === "failed" && isCron,
  };

  // Once-daily roll-up of who is still on an old extension build.
  //
  // Deliberately not a live alert: the extension posts to /api/extension-status
  // every 30 seconds, so alerting the moment an outdated version is reported
  // would repeat forever — there is no column recording that we already said
  // it. Running off the daily cron gives one message regardless of how many
  // check-ins happen in between.
  //
  // Cron-only, so a manual health check never fires a team-wide message.
  let outdated: string[] = [];
  if (isCron && telegramEnabled("ops")) {
    const { data: statuses } = await supabase
      .from("extension_upload_status")
      .select("user_id, extension_version");

    const behind = (statuses ?? []).filter(
      (s) => s.extension_version && isVersionOlder(s.extension_version as string, EXTENSION_LATEST_VERSION)
    );

    if (behind.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, username, telegram_chat_id")
        .in("id", behind.map((s) => s.user_id));

      const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
      outdated = behind.map(
        (s) =>
          `${byId.get(s.user_id as string)?.full_name || byId.get(s.user_id as string)?.username || "Someone"} — ${s.extension_version}`
      );

      // Each person is told directly rather than named on a list the whole team
      // reads. Their own copy carries the store link, which is the only part
      // they can act on, and Toni gets a log line per send.
      for (const s of behind) {
        const p = byId.get(s.user_id as string);
        const name = p?.full_name || p?.username || "Someone";
        await notifyVaPrivately({
          chatId: p?.telegram_chat_id,
          userId: s.user_id as string,
          vaName: name,
          topic: "Extension update",
          message: [
            `🧩 <b>A newer MinuteFlow extension is out</b> — v${esc(EXTENSION_LATEST_VERSION)}`,
            "",
            `You are on ${esc(String(s.extension_version))}. Most installs update themselves, so if yours has not, open the store page and update it by hand.`,
            "",
            EXTENSION_STORE_URL,
          ].join("\n"),
        });
      }
    }
  }

  const httpStatus = tokenStatus === "failed" ? 503 : 200;
  return Response.json({ ...report, outdated }, { status: httpStatus });
}
