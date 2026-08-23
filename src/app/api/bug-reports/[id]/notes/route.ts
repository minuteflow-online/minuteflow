import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { sendDriveFilesToTelegram } from "@/lib/driveFetch";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Notes on a bug report — a running thread either side can add to.
 *
 * A report used to be write-once: whoever filed it could not add the detail they
 * forgot, and the only reply channel was a single admin_notes field that the
 * reviewer overwrote each time. This is the conversation instead.
 *
 * Visibility follows the report: you can read and add notes on a report that is
 * yours, or on any report if you review them.
 */

/** Postgres "relation does not exist" — the notes table has not been created yet. */
const UNDEFINED_TABLE = "42P01";

async function loadContext(reportId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, full_name, username")
    .eq("id", user.id)
    .single();

  const { data: report } = await supabase
    .from("bug_reports")
    .select("id, user_id, title, report_type")
    .eq("id", reportId)
    .single();

  if (!report) return { error: "Report not found" as const, status: 404 };

  const allowed = report.user_id === user.id || hasBroadAdminAccess(profile);
  if (!allowed) return { error: "Forbidden" as const, status: 403 };

  return { supabase, user, profile, report };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const ctx = await loadContext(Number(id));
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const { data, error } = await ctx.supabase
    .from("bug_report_notes")
    .select("*")
    .eq("report_id", Number(id))
    .order("created_at", { ascending: true });

  if (error) {
    // Before the table exists the feature simply isn't there yet; callers render
    // nothing rather than showing an error on every report.
    if (error.code === UNDEFINED_TABLE) return Response.json({ notes: [], unavailable: true });
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ notes: data || [] });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const ctx = await loadContext(Number(id));
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const body = await request.json();
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const driveFileIds: string[] = Array.isArray(body.drive_file_ids)
    ? body.drive_file_ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  // A note can be an image on its own — "here is what I mean" needs no caption.
  if (!text && driveFileIds.length === 0) {
    return Response.json({ error: "a note needs text or an attachment" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("bug_report_notes")
    .insert({
      report_id: Number(id),
      user_id: ctx.user.id,
      full_name: ctx.profile?.full_name || ctx.profile?.username || "",
      body: text,
      drive_file_ids: driveFileIds,
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNDEFINED_TABLE) {
      return Response.json({ error: "Notes are not enabled yet" }, { status: 503 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  // A note is the reply channel between the person who filed a report and
  // whoever is working it, so it is worth surfacing — otherwise a question
  // sits unanswered until someone happens to reopen the report.
  //
  // Best-effort: the note is saved, and a Telegram problem must not fail it.
  if (telegramEnabled("bugs")) {
    // Fetched separately and tolerated as missing: the column may not exist
    // yet, and a report filed before threading has no id to reply to.
    const { data: thread } = await ctx.supabase
      .from("bug_reports")
      .select("telegram_message_id")
      .eq("id", Number(id))
      .single();

    const kind = ctx.report.report_type === "feature" ? "Feature request" : "Bug report";
    const who = ctx.profile?.full_name || ctx.profile?.username || "Someone";
    const shown = text.length > 400 ? text.slice(0, 400) + "…" : text;

    const lines = [`📝 <b>Note on ${kind}</b> — ${esc(ctx.report.title ?? "")}`, `${esc(who)}:`];
    // A note can be an attachment with no words; say so rather than posting a
    // name followed by nothing.
    lines.push(
      shown
        ? esc(shown)
        : `(${driveFileIds.length} attachment${driveFileIds.length === 1 ? "" : "s"})`
    );
    if (shown && driveFileIds.length > 0) {
      lines.push(`+ ${driveFileIds.length} attachment${driveFileIds.length === 1 ? "" : "s"}`);
    }
    lines.push("", "Review: https://minuteflow.click/admin");

    const anchor = thread?.telegram_message_id ?? undefined;
    const sent = await sendTelegram("bugs", lines.join("\n"), { replyToMessageId: anchor });

    // A report announced before threading existed has no message to reply to,
    // and Telegram offers no way to look up what the bot posted in the past.
    // So the first alert that finds no anchor becomes one: everything after it
    // on this report threads under this note instead. Older reports get a
    // thread starting from their next bit of activity rather than none at all.
    if (!anchor && sent.messageId) {
      const { error: anchorError } = await ctx.supabase
        .from("bug_reports")
        .update({ telegram_message_id: sent.messageId })
        .eq("id", Number(id));
      if (anchorError) {
        console.warn("bug-report notes: could not store anchor", anchorError.message);
      }
    }

    // Under the note itself where possible, so the picture sits with the words
    // that introduced it rather than at the bottom of the report's thread.
    if (driveFileIds.length > 0) {
      await sendDriveFilesToTelegram(
        "bugs",
        driveFileIds,
        sent.messageId ?? thread?.telegram_message_id ?? undefined
      );
    }
  }

  return Response.json({ note: data }, { status: 201 });
}
