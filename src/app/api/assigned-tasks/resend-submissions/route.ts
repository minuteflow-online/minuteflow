import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { canReviewSubmissions } from "@/lib/submissions";
import { sendTelegram, sendTelegramPhoto, sendTelegramDocument, telegramEnabled, esc, mention } from "@/lib/telegram";
import { reviewLinks } from "@/lib/reviewLinks";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/assigned-tasks/resend-submissions?since=YYYY-MM-DD&confirm=1
 *
 * Reposts submissions that were announced before the alert carried the work.
 *
 * The original messages named the task and offered Approve and Needs revision
 * while showing neither the link nor the files, so there was nothing to review
 * in them. Rather than editing history, this sends them again in full.
 *
 * Dry run by default. Nothing records that a submission has been reposted, so
 * a second confirmed run posts everything twice — meant to be used once and
 * then left alone.
 *
 * Reviewer-only, same bar as approving one.
 */

const MAX_FILES_POSTED = 5;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();
  if (!canReviewSubmissions(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!telegramEnabled("submissions")) {
    return Response.json({ error: "Telegram is not configured for submissions" }, { status: 400 });
  }

  const since = request.nextUrl.searchParams.get("since") ?? new Date().toISOString().slice(0, 10);
  const confirm = request.nextUrl.searchParams.get("confirm") === "1";

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: subs, error } = await admin
    .from("task_submissions")
    .select("id, assigned_task_id, user_id, content, submission_link, created_at")
    .eq("message_type", "submission")
    .gte("created_at", since)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = subs ?? [];
  if (!confirm) {
    return Response.json({
      wouldSend: rows.length,
      since,
      hint: "Add &confirm=1 to send. Running it twice posts everything twice.",
    });
  }

  const sent: number[] = [];

  for (const s of rows) {
    const { data: task } = await admin
      .from("assigned_tasks")
      .select("task_name, account, project, status")
      .eq("id", s.assigned_task_id)
      .single();

    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", s.user_id)
      .single();

    const who = prof?.full_name || prof?.username || "A VA";
    const where = [task?.account, task?.project].filter(Boolean).join(" / ");
    const link = String(s.submission_link ?? "");
    const note = String(s.content ?? "").trim();

    const lines = [
      `📤 <b>Submission</b> from ${mention(who, prof?.telegram_chat_id)}`,
      `Task: ${esc(String(task?.task_name ?? "a task"))}`,
    ];
    if (where) lines.push(`Project: ${esc(where)}`);
    // Only a real URL. "N/A" in that box means nothing was handed in, and
    // dressing it up as a link would say otherwise.
    if (/^https?:\/\//i.test(link)) lines.push("", `🔗 ${esc(link)}`);
    if (note) lines.push("", esc(note.length > 400 ? note.slice(0, 400) + "…" : note));

    // Buttons only where the decision is still open — a task already approved
    // or sent back does not need deciding again.
    if (task?.status === "submitted") {
      const links = reviewLinks(Number(s.assigned_task_id));
      lines.push(
        "",
        `<a href="${links.approve}">✅ Approve</a>  •  <a href="${links.revision}">🔁 Needs revision</a>`
      );
    } else if (task?.status) {
      lines.push(`Status: ${esc(String(task.status))}`);
    }
    lines.push("", "Review: https://minuteflow.click/admin");

    const posted = await sendTelegram("submissions", lines.join("\n"));

    const { data: files } = await admin
      .from("assigned_task_attachments")
      .select("filename, storage_path, mime_type")
      .eq("submission_id", s.id)
      .limit(MAX_FILES_POSTED);

    for (const file of files ?? []) {
      const { data: signed } = await admin.storage
        .from("task-attachments")
        .createSignedUrl(file.storage_path as string, 300);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const name = String(file.filename ?? "file");

      if (String(file.mime_type ?? "").startsWith("image/")) {
        await sendTelegramPhoto("submissions", bytes, name, { replyToMessageId: posted.messageId });
      } else {
        await sendTelegramDocument("submissions", bytes, name, { replyToMessageId: posted.messageId });
      }
    }

    if (posted.ok) sent.push(s.id as number);
  }

  return Response.json({ sent: sent.length, of: rows.length, ids: sent });
}
