import { createClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";
import { NextRequest } from "next/server";
import { sendTelegram, telegramEnabled, esc } from "@/lib/telegram";
import { sendDriveFilesToTelegram } from "@/lib/driveFetch";

export const dynamic = "force-dynamic";

/**
 * Tags are free text, so they are lowercased and de-duplicated on the way in —
 * otherwise "Invoices", "invoices" and " invoices" become three separate topics
 * and filtering by any one of them misses the others.
 */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  return Array.from(new Set(cleaned));
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department")
    .eq("id", user.id)
    .single();

  const isAdmin = hasBroadAdminAccess(profile);

  let query = supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ reports: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, full_name")
    .eq("id", user.id)
    .single();

  const body = await request.json();
  const { title, description, report_date, drive_file_ids, report_type, tags } = body;

  if (!title?.trim() || !description?.trim()) {
    return Response.json({ error: "title and description are required" }, { status: 400 });
  }

  // One endpoint serves both — anything that isn't an explicit feature request
  // is a bug, which keeps older clients posting bugs exactly as before.
  const reportType = report_type === "feature" ? "feature" : "bug";

  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      user_id: user.id,
      username: profile?.username || "",
      full_name: profile?.full_name || "",
      report_type: reportType,
      title: title.trim(),
      description: description.trim(),
      report_date: report_date || new Date().toISOString().split("T")[0],
      status: "submitted",
      drive_file_ids: drive_file_ids || [],
      tags: normalizeTags(tags),
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Best-effort ping — the report is already saved, so a send failure is not
  // worth surfacing to the VA who filed it.
  if (telegramEnabled("bugs")) {
    const who = profile?.full_name || profile?.username || "Someone";
    const desc = description.trim();
    const heading = reportType === "feature" ? "💡 <b>Feature request</b>" : "🐞 <b>Bug report</b>";
    const sent = await sendTelegram(
      "bugs",
      [
        `${heading} from ${esc(who)}`,
        esc(title.trim()),
        "",
        esc(desc.length > 400 ? desc.slice(0, 400) + "…" : desc),
        "",
        "Review: https://minuteflow.click/admin",
      ].join("\n")
    );

    // Remember which message announced this report so later status changes can
    // reply to it and Telegram threads them together. Written separately and
    // its error swallowed: the column may not exist yet, and a report that
    // saved fine must not fail over a missing nicety.
    if (sent.messageId) {
      const { error: threadError } = await supabase
        .from("bug_reports")
        .update({ telegram_message_id: sent.messageId })
        .eq("id", data.id);
      if (threadError) {
        console.warn("bug-reports: could not store telegram_message_id", threadError.message);
      }
    }

    // Screenshots under the report they belong to. A bug is usually easier to
    // recognise from the picture than the description.
    const attachments: string[] = Array.isArray(drive_file_ids)
      ? drive_file_ids.filter((f: unknown): f is string => typeof f === "string")
      : [];
    if (attachments.length > 0) {
      await sendDriveFilesToTelegram("bugs", attachments, sent.messageId);
    }
  }

  return Response.json({ report: data }, { status: 201 });
}

/** Statuses a report moves through — see ReportStatus in BugReportsAdminTab.
 *  Kept as a lookup rather than raw values so the chat reads as a sentence and
 *  an unrecognised status still falls through to something sensible. */
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  testing: "In testing",
  fixed: "Fixed",
  dismissed: "Dismissed",
};

const STATUS_EMOJI: Record<string, string> = {
  submitted: "📥",
  testing: "🧪",
  fixed: "✅",
  dismissed: "🚫",
};

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, full_name, username")
    .eq("id", user.id)
    .single();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await supabase
    .from("bug_reports")
    .select("user_id, status")
    .eq("id", Number(id))
    .single();
  if (!existing) return Response.json({ error: "Report not found" }, { status: 404 });

  const isReviewer = hasBroadAdminAccess(profile);
  const isOwner = existing.user_id === user.id;

  const body = await request.json();
  const {
    status,
    admin_notes,
    archived,
    title,
    description,
    drive_file_ids,
    tags,
    dismiss_reason,
  } = body;

  const updates: Record<string, unknown> = {};

  // The person who filed a report can correct it, but only while nobody has
  // started on it. Once a reviewer moves it to testing the wording is what they
  // are testing against, so it freezes — anything further goes in the note
  // thread, which stays open to both sides for the life of the report.
  if (
    title !== undefined ||
    description !== undefined ||
    drive_file_ids !== undefined
  ) {
    if (!isOwner && !isReviewer) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status !== "submitted") {
      return Response.json(
        { error: "This report is already being worked on and can no longer be edited. Add a note instead." },
        { status: 409 }
      );
    }
    if (typeof title === "string") {
      if (!title.trim()) return Response.json({ error: "title cannot be empty" }, { status: 400 });
      updates.title = title.trim();
    }
    if (typeof description === "string") {
      if (!description.trim()) {
        return Response.json({ error: "description cannot be empty" }, { status: 400 });
      }
      updates.description = description.trim();
    }
    if (Array.isArray(drive_file_ids)) {
      updates.drive_file_ids = drive_file_ids.filter((f: unknown) => typeof f === "string");
    }
  }

  // Tagging is triage, so a reviewer can retag at any point in a report's life.
  // The person who filed it can tag their own while it is still theirs to edit.
  if (tags !== undefined) {
    const canTag = isReviewer || (isOwner && existing.status === "submitted");
    if (!canTag) {
      return Response.json(
        { error: "This report can no longer be edited. Add a note instead." },
        { status: 409 }
      );
    }
    updates.tags = normalizeTags(tags);
  }

  // Status, reviewer notes and archiving stay reviewer-only, whether or not the
  // caller happens to have filed the report themselves.
  if (status !== undefined || admin_notes !== undefined || archived !== undefined) {
    if (!isReviewer) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (Object.keys(updates).length === 0 && !isReviewer) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  // A dismissal without a reason tells whoever filed the report nothing except
  // that it is closed, so the reason is required here rather than left to the
  // form to remember — the API is what actually guarantees it.
  if (status === "dismissed") {
    const reason = typeof dismiss_reason === "string" ? dismiss_reason.trim() : "";
    if (!reason) {
      return Response.json(
        { error: "A reason is required when dismissing a report" },
        { status: 400 }
      );
    }
    updates.dismiss_reason = reason;
  } else if (status) {
    // Reopened or resolved another way: the old reason no longer describes it.
    updates.dismiss_reason = null;
  }

  if (status) updates.status = status;
  // Whoever moves a report off Submitted owns it from that point — the question
  // "who is looking at this?" is otherwise unanswerable without asking around.
  // Moving it back to Submitted clears the owner rather than leaving a stale name
  // on a report nobody is holding.
  if (status && status !== existing.status) {
    const isClaim = status !== "submitted";
    updates.handled_by = isClaim ? user.id : null;
    updates.handled_by_name = isClaim
      ? profile?.full_name || profile?.username || "Unknown"
      : null;
    updates.handled_at = isClaim ? new Date().toISOString() : null;
  }
  if (admin_notes !== undefined) updates.admin_notes = admin_notes;
  // Both endings count as reviewed: dismissing a request is a decision, not a
  // report left untouched.
  if (status === "fixed" || status === "dismissed") {
    updates.reviewed_at = new Date().toISOString();
  }
  // Archiving is separate from status — a fixed report and a dismissed one can
  // both be filed away, and either can come back out.
  if (archived !== undefined) {
    updates.archived_at = archived ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from("bug_reports")
    .update(updates)
    .eq("id", Number(id))
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Announce a real status move. Compared against the row as it was, so
  // re-saving the same status — or editing notes and tags — stays silent;
  // otherwise triage would fill the chat with updates that changed nothing.
  if (status && status !== existing.status && telegramEnabled("bugs")) {
    const kind = data.report_type === "feature" ? "Feature request" : "Bug report";
    const filedBy = data.full_name || data.username || "someone";
    // Reply to the message that announced the report, so its whole history
    // reads as one thread. Looked up on its own and tolerated as missing —
    // reports filed before this existed have no stored id.
    const { data: thread } = await supabase
      .from("bug_reports")
      .select("telegram_message_id")
      .eq("id", Number(id))
      .single();
    const replyTo = thread?.telegram_message_id ?? undefined;

    const lines = [
      `${STATUS_EMOJI[status] ?? "🔄"} <b>${kind} — ${esc(STATUS_LABELS[status] ?? status)}</b>`,
      esc(data.title ?? ""),
      `Filed by ${esc(filedBy)} · was ${esc(STATUS_LABELS[existing.status] ?? existing.status)}`,
    ];

    // Why it was dismissed is the whole point of the message. It is new
    // information rather than a repeat of the filing, so it goes out whether
    // or not this ends up threaded.
    const dismissReason = (data.dismiss_reason ?? "").trim();
    if (status === "dismissed" && dismissReason) {
      lines.push(
        "",
        `Reason: ${esc(dismissReason.length > 400 ? dismissReason.slice(0, 400) + "…" : dismissReason)}`
      );
    }

    // The original wording is only repeated when this cannot be threaded. As a
    // reply the filing is right there above it, so restating it is noise — but
    // an older report posts standalone, and "Fixed" with no context is useless.
    if (!replyTo) {
      const detail = (data.description ?? "").trim();
      if (detail) {
        lines.push("", esc(detail.length > 400 ? detail.slice(0, 400) + "…" : detail));
      }
    }

    lines.push("", "Review: https://minuteflow.click/admin");
    await sendTelegram("bugs", lines.join("\n"), { replyToMessageId: replyTo });
  }

  return Response.json({ report: data });
}
