import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";

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
      .select("extension_version, consecutive_failures")
      .eq("user_id", userId)
      .single();

    const previousVersion = existingStatus?.extension_version ?? null;
    const previousFailures = Number(existingStatus?.consecutive_failures ?? 0);
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

    // Once per streak, judged against what was stored rather than the number
    // being equal to three. The extension re-reports the same count on every
    // 30-second check-in, so "=== 3" fired again each time it repeated itself —
    // which is how the same warning arrived twice, four minutes apart.
    const crossedFailureThreshold = previousFailures < 3 && consecutiveFailures >= 3;

    if (crossedFailureThreshold) {
      // Get VA name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, username, telegram_chat_id")
        .eq("id", userId)
        .single();

      const vaName = profile?.full_name || profile?.username || "A team member";

      // Email goes to admins only, for the same reason as the Telegram line:
      // it describes a Drive connection problem, which is not something the
      // person whose laptop it is can do anything about.
      if (RESEND_API_KEY) {
        const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const { data: adminProfiles } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        const adminIds = new Set((adminProfiles ?? []).map((p) => p.id));
        const to =
          authData?.users
            .filter((u) => adminIds.has(u.id) && u.email)
            .map((u) => u.email as string) ?? [];

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

      // Toni only. This used to go to the VA as well, and it was the wrong
      // audience: the message talked about queued files and Drive connections,
      // none of which a VA can act on, so it read as being told something was
      // broken and left them with nowhere to go. It also fires when someone
      // simply closed their laptop, which is not a fault at all.
      //
      // VAs still hear about genuine idleness — that one they can act on.
      if (telegramEnabled("ops")) {
        await sendTelegram(
          "ops",
          [
            `📷 <b>${esc(vaName)}</b> — screenshots not uploading`,
            "Three uploads in a row did not reach Drive. They are queued on their machine and will send when the connection returns.",
            "",
            "Status: https://minuteflow.click/admin",
          ].join("\n")
        );
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
