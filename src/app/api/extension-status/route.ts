import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/extension-status
 * Called by the Chrome extension every 30s to report upload queue status.
 * Upserts per-VA stats and triggers an admin email alert after 3 consecutive failures.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, queued, uploadedToday, consecutiveFailures, version } = body;

    if (
      !userId ||
      typeof queued !== "number" ||
      typeof uploadedToday !== "number" ||
      typeof consecutiveFailures !== "number"
    ) {
      return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Upsert upload status row for this VA
    const { error: upsertError } = await supabase
      .from("extension_upload_status")
      .upsert(
        {
          user_id: userId,
          queued_count: queued,
          uploaded_today: uploadedToday,
          consecutive_failures: consecutiveFailures,
          last_reported_at: new Date().toISOString(),
          ...(version ? { extension_version: String(version) } : {}),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return Response.json({ error: upsertError.message }, { status: 500 });
    }

    // Send admin alert exactly when failures hit 3 (once per streak — extension sends flag)
    if (consecutiveFailures === 3 && RESEND_API_KEY) {
      // Get VA name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", userId)
        .single();

      const vaName = profile?.full_name || profile?.username || "A team member";

      // Get all admin profile IDs
      const { data: adminProfiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin");

      if (adminProfiles && adminProfiles.length > 0) {
        // Get auth emails for admins
        const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const adminIds = new Set(adminProfiles.map((p) => p.id));
        const adminEmails =
          authData?.users
            .filter((u) => adminIds.has(u.id) && u.email)
            .map((u) => u.email as string) ?? [];

        // Send alert to each admin
        for (const email of adminEmails) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "MinuteFlow <noreply@minuteflow.click>",
              to: [email],
              subject: `⚠️ Screenshot Upload Issue — ${vaName}`,
              html: `
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                  <h2 style="color:#c0392b">Screenshot Upload Alert</h2>
                  <p><strong>${vaName}</strong>'s MinuteFlow extension is having trouble uploading screenshots to Google Drive.</p>
                  <p>There have been <strong>3 consecutive failed upload attempts</strong>. Screenshots are being saved locally on their computer and will upload automatically when the connection is restored.</p>
                  <p>You can monitor their upload status on the <a href="https://minuteflow.click/admin">Admin Dashboard → Overview</a>.</p>
                  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
                  <p style="color:#888;font-size:12px">This alert fires once per failure streak and resets automatically when uploads resume. — MinuteFlow</p>
                </div>
              `,
            }),
          });
        }
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
