import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { notifyVaPrivately } from "@/lib/vaNotify";

export const dynamic = "force-dynamic";

/** Returns true if version string `a` is strictly greater than `b` (semver comparison). */
function isNewerVersion(a: string, b: string): boolean {
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

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

    // Check existing version before upsert so we can detect upgrades
    const { data: existingStatus } = await supabase
      .from("extension_upload_status")
      .select("extension_version")
      .eq("user_id", userId)
      .single();

    const previousVersion = existingStatus?.extension_version ?? null;
    const newVersion = version ? String(version) : null;

    // Only treat as an upgrade if the new version is strictly greater than what's stored.
    // This prevents ping-pong between two machines running different extension versions.
    const isUpgrade =
      newVersion !== null &&
      (previousVersion === null || isNewerVersion(newVersion, previousVersion));

    // Only update the stored version when it's a genuine upgrade — never downgrade.
    const versionUpdate = isUpgrade ? { extension_version: newVersion } : {};

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
          ...versionUpdate,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return Response.json({ error: upsertError.message }, { status: 500 });
    }

    // Notify only on genuine installs or upgrades (never on downgrades/same).
    //
    // Posted directly to TELEGRAM_GROUP_CHAT_ID until now, which named a group
    // the current bot is not a member of — so these sends failed silently.
    // Going through the shared sender puts them in the submissions chat with
    // the rest of the day-to-day operations alerts.
    if (isUpgrade && telegramEnabled("submissions")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", userId)
        .single();

      const vaName = profile?.full_name || profile?.username || "A team member";
      const action = previousVersion ? "updated" : "installed";
      const versionLine = previousVersion
        ? `${previousVersion} → ${newVersion}`
        : `v${newVersion}`;

      await sendTelegram(
        "submissions",
        `🔌 <b>${esc(vaName)}</b> ${action} the MinuteFlow extension (${esc(versionLine)})`
      );
    }

    // Send admin alert exactly when failures hit 3 (once per streak — extension sends flag)
    if (consecutiveFailures === 3) {
      // Get VA name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username, telegram_chat_id")
        .eq("id", userId)
        .single();

      const vaName = profile?.full_name || profile?.username || "A team member";

      // Detail by email — to the VA, whose machine has to be looked at, with
      // admins copied. The team chat only carries the notice, so nobody is
      // described as broken in front of everyone.
      if (RESEND_API_KEY) {
        const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const vaEmail = authData?.users.find((u) => u.id === userId)?.email ?? null;

        const { data: adminProfiles } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        const adminIds = new Set((adminProfiles ?? []).map((p) => p.id));
        const adminEmails =
          authData?.users
            .filter((u) => adminIds.has(u.id) && u.email && u.email !== vaEmail)
            .map((u) => u.email as string) ?? [];

        // With no address for the VA the admins become the recipients, so the
        // alert still goes somewhere rather than being dropped.
        const to = vaEmail ? [vaEmail] : adminEmails;
        const cc = vaEmail ? adminEmails : [];

        if (to.length > 0) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "MinuteFlow <noreply@minuteflow.click>",
              to,
              ...(cc.length > 0 ? { cc } : {}),
              subject: `⚠️ Screenshot uploads failing — ${vaName}`,
              html: `
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                  <h2 style="color:#c0392b">Screenshot Upload Alert</h2>
                  <p><strong>${vaName}</strong>'s MinuteFlow extension is having trouble uploading screenshots to Google Drive.</p>
                  <p>There have been <strong>3 consecutive failed upload attempts</strong>. Screenshots are being saved locally on that computer and will upload automatically when the connection is restored.</p>
                  <p>If this keeps happening, check the internet connection and that the MinuteFlow extension is still enabled in Chrome.</p>
                  <p>Upload status is on the <a href="https://minuteflow.click/admin">Admin Dashboard → Overview</a>.</p>
                  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
                  <p style="color:#888;font-size:12px">This alert fires once per failure streak and resets automatically when uploads resume. — MinuteFlow</p>
                </div>
              `,
            }),
          });
        }
      }

      // Straight to the person whose machine it is, plus a log line for Toni.
      // Nothing goes to the team chat — whose setup is broken is not the
      // team's business, and the person needs to see it in time to fix it.
      await notifyVaPrivately({
        chatId: profile?.telegram_chat_id,
        vaName,
        topic: "Screenshot",
        message: [
          "📷 <b>Your screenshots are not uploading</b>",
          "",
          "Three uploads in a row did not reach Drive. They are saved on your computer and will upload on their own once the connection is back.",
          "If it keeps happening, check your internet and that the MinuteFlow extension is still enabled in Chrome.",
        ].join("\n"),
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
