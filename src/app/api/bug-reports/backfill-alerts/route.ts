import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/bug-reports/backfill-alerts?confirm=1
 *
 * One-off catch-up. Status changes only started announcing themselves once the
 * PATCH handler learned to, so reports moved before that never got a message.
 * This posts their current status once so the chat matches reality.
 *
 * Nothing records that a report has been announced, so running this twice
 * posts everything twice — hence ?confirm=1, and hence it being a temporary
 * endpoint rather than something left lying around. Delete it once used.
 *
 * Reviewer-only, same bar as changing a status by hand.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();
  if (!hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!telegramEnabled("bugs")) {
    return Response.json({ error: "Telegram is not configured for bug reports" }, { status: 400 });
  }

  const { data: reports, error } = await supabase
    .from("bug_reports")
    .select("id, report_type, status, title, full_name, username, reviewed_at")
    .neq("status", "submitted")
    .order("reviewed_at", { ascending: true, nullsFirst: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const pending = reports ?? [];

  // Dry run by default: shows what would go out before anything is sent.
  if (request.nextUrl.searchParams.get("confirm") !== "1") {
    return Response.json({
      wouldSend: pending.length,
      reports: pending.map((r) => `${r.report_type} #${r.id} — ${r.status} — ${r.title}`),
      hint: "Add ?confirm=1 to send. Running it twice posts everything twice.",
    });
  }

  const STATUS_LABELS: Record<string, string> = {
    testing: "In testing",
    fixed: "Fixed",
    dismissed: "Dismissed",
  };
  const STATUS_EMOJI: Record<string, string> = {
    testing: "🧪",
    fixed: "✅",
    dismissed: "🚫",
  };

  const sent: number[] = [];
  for (const r of pending) {
    const kind = r.report_type === "feature" ? "Feature request" : "Bug report";
    const filedBy = r.full_name || r.username || "someone";
    const result = await sendTelegram(
      "bugs",
      [
        `${STATUS_EMOJI[r.status] ?? "🔄"} <b>${kind} — ${esc(STATUS_LABELS[r.status] ?? r.status)}</b>`,
        esc(r.title ?? ""),
        `Filed by ${esc(filedBy)}`,
        "",
        "Review: https://minuteflow.click/admin",
      ].join("\n")
    );
    if (result.ok) sent.push(r.id);
  }

  return Response.json({ sent: sent.length, ids: sent, of: pending.length });
}
