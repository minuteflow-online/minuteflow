import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasFinancialAccess } from "@/lib/financialAccess";
import { sendTelegram, telegramEnabled, chatIdFor, esc } from "@/lib/telegram";
import { checkShiftAnomalies, formatShiftMessage } from "@/lib/shiftAnomalies";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/shift-review?person=<name>&date=YYYY-MM-DD&confirm=1
 *
 * Runs the shift review for one person and one day on demand, rather than
 * waiting for their next clock-out.
 *
 * The cron cannot be triggered from a browser — it wants an Authorization
 * header no link can carry — so without this, testing the reply-to-fix flow
 * meant waiting for someone to finish a shift and hoping that shift happened
 * to have an anomaly in it. This also covers the ordinary case of wanting to
 * re-examine a day that has already been reviewed.
 *
 * Dry run by default: the message comes back as text so it can be read before
 * anything reaches the chat. Financial access only, matching the gate on
 * actioning a reply — this posts billable-hour detail about a named person.
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
  if (!hasFinancialAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!telegramEnabled("financial")) {
    return Response.json({ error: "TELEGRAM_BUDGET_CHAT_ID is not set" }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const person = (params.get("person") ?? "").trim();
  const date = (params.get("date") ?? "").trim();

  if (!person || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "Need ?person=<name> and ?date=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: matches } = await admin
    .from("profiles")
    .select("id, full_name, username")
    .ilike("full_name", `%${person}%`)
    .eq("is_active", true);

  // Ambiguity is reported rather than resolved by picking the first row: this
  // posts someone's hours to a chat, and the wrong someone is not recoverable.
  if (!matches || matches.length === 0) {
    return Response.json({ error: `No active person matching "${person}"` }, { status: 404 });
  }
  if (matches.length > 1) {
    return Response.json({
      error: `"${person}" matches ${matches.length} people — be more specific.`,
      matches: matches.map((m) => m.full_name),
    }, { status: 400 });
  }

  const target = matches[0];
  const who = (target.full_name as string) || (target.username as string) || "Someone";
  const result = await checkShiftAnomalies(admin, target.id as string, date);

  if (result.logs.length === 0) {
    return Response.json({ error: `${who} has no time logged on ${date}.` }, { status: 404 });
  }

  const message = formatShiftMessage(esc(who), date, result);

  if (params.get("confirm") !== "1") {
    return Response.json({
      wouldPost: true,
      person: who,
      date,
      findings: result.findings.length,
      entries: result.logs.length,
      preview: message.replace(/<[^>]+>/g, ""),
      hint: "Add &confirm=1 to post it to the finance chat.",
    });
  }

  const posted = await sendTelegram("financial", message);
  const chatId = chatIdFor("financial");

  // Same record the cron writes, so a reply to a hand-fired review is traced
  // back exactly as one to a scheduled review.
  if (posted.messageId && chatId) {
    await admin.from("telegram_anomaly_alerts").insert({
      chat_id: Number(chatId),
      message_id: posted.messageId,
      user_id: target.id,
      session_date: date,
      findings: result.findings,
    });
  }

  return Response.json({
    ok: posted.ok,
    person: who,
    date,
    findings: result.findings.length,
    messageId: posted.messageId ?? null,
    error: posted.error,
  });
}
