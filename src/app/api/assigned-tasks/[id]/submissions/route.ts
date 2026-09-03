import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import {
  canReviewSubmissions,
  submissionSummary,
  submissionMeetsBar,
  MIN_SUBMISSION_WORDS,
  type SubmissionMessageType,
} from "@/lib/submissions";
import { sendTelegram, sendTelegramPhoto, sendTelegramDocument, telegramEnabled, esc, mention } from "@/lib/telegram";
import { reviewLinks, cheerApproval } from "@/lib/reviewLinks";
import { submissionCheer } from "@/lib/submissionCheer";
import { notifyRecipients } from "@/lib/notifyRecipients";
import { syncFixedPayTaskStatus } from "@/lib/fixedPayTaskSync";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type CallerProfile = {
  role?: string | null;
  department?: string | null;
  admin_permissions?: string[] | null;
} | null;

/**
 * Categories that are logged rather than reviewed. Work in these completes the
 * moment it's submitted and stays out of the review queue — only "Task" work
 * is something a reviewer is expected to look at.
 */
const AUTO_COMPLETE_CATEGORIES = ["Communication", "Planning", "Collaboration"];

const SUBMISSION_SELECT =
  "id, assigned_task_id, user_id, message_type, content, submission_link, submission_comment, created_at, edited_at, edited_by, profiles!task_submissions_user_id_profiles_fkey(id, full_name, username)";

function isAdminEquivalent(profile: CallerProfile) {
  return profile?.role === "admin" || profile?.role === "manager" || hasAdminPermission(profile, "task_management");
}

/** Same access rule as task attachments: admin-equivalent, or an assignee of the task. */
async function canAccessTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  userId: string,
  profile: CallerProfile
) {
  if (isAdminEquivalent(profile)) return true;

  const { data, error } = await supabase
    .from("assigned_task_assignees")
    .select("id")
    .eq("assigned_task_id", taskId)
    .eq("va_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return Boolean(data);
}

function adminClient() {
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Attaches each submission's files, with signed URLs (1 hour), to its row. */
async function withAttachments(
  admin: ReturnType<typeof adminClient>,
  submissions: Array<Record<string, unknown> & { id: number }>
) {
  if (submissions.length === 0) return [];

  const { data: files } = await admin
    .from("assigned_task_attachments")
    .select("id, submission_id, filename, storage_path, file_size, mime_type")
    .in(
      "submission_id",
      submissions.map((s) => s.id)
    );

  const bySubmission = new Map<number, Array<Record<string, unknown>>>();
  await Promise.all(
    (files ?? []).map(async (file) => {
      const { data: signed } = await admin.storage
        .from("task-attachments")
        .createSignedUrl(file.storage_path as string, 3600);
      const list = bySubmission.get(file.submission_id as number) ?? [];
      list.push({ ...file, url: signed?.signedUrl ?? null });
      bySubmission.set(file.submission_id as number, list);
    })
  );

  return submissions.map((s) => ({ ...s, attachments: bySubmission.get(s.id) ?? [] }));
}

/** Enough to show the work without turning one submission into a wall of
 *  images. Anything past this stays in the admin panel. */
const MAX_FILES_POSTED = 5;

/**
 * Posts a submission's files into the submissions chat, under its alert.
 *
 * Images go as photos so they can be judged at a glance; everything else goes
 * as a document, which Telegram shows by filename with a download button.
 * sendPhoto rejects anything that is not an image, so the split is required
 * rather than cosmetic — a PDF sent as a photo simply fails.
 *
 * Entirely best-effort: the submission is saved and the alert delivered before
 * this runs, so a file that will not load costs nothing.
 */
async function postSubmissionFiles(
  admin: ReturnType<typeof adminClient>,
  submissionId: number,
  replyToMessageId?: number
): Promise<void> {
  try {
    const { data: files } = await admin
      .from("assigned_task_attachments")
      .select("filename, storage_path, mime_type")
      .eq("submission_id", submissionId)
      .limit(MAX_FILES_POSTED);

    for (const file of files ?? []) {
      // Five minutes is plenty to fetch it and hand it to Telegram, and short
      // enough that the URL is useless if it ever escaped a log.
      const { data: signed } = await admin.storage
        .from("task-attachments")
        .createSignedUrl(file.storage_path as string, 300);
      if (!signed?.signedUrl) continue;

      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const name = String(file.filename ?? "file");

      if (String(file.mime_type ?? "").startsWith("image/")) {
        await sendTelegramPhoto("submissions", bytes, name, { replyToMessageId });
      } else {
        await sendTelegramDocument("submissions", bytes, name, { replyToMessageId });
      }
    }
  } catch (err) {
    console.error("submission files to telegram failed:", err);
  }
}

/**
 * GET /api/assigned-tasks/[id]/submissions
 * The full thread for one task, oldest first.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    if (!(await canAccessTask(supabase, id, user.id, profile))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to verify access" },
      { status: 500 }
    );
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from("task_submissions")
    .select(SUBMISSION_SELECT)
    .eq("assigned_task_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    submissions: await withAttachments(admin, (data ?? []) as never),
  });
}

/**
 * POST /api/assigned-tasks/[id]/submissions
 *
 * Accepts multipart/form-data (`message`, `link`, and zero or more `file`) or
 * JSON (`{ message, link, message_type }`). Files land in the same
 * `task-attachments` bucket as regular task attachments and are tagged with
 * the new submission's id, which is what the "Submission" label in the task
 * editor keys off.
 *
 * This route does NOT move the task's status — the caller follows a successful
 * POST with setAssignedTaskStatus(), so every status write in the app keeps
 * going through that one path (see src/lib/assignedTaskStatus.ts).
 */
export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();

  const { id } = await params;

  try {
    if (!(await canAccessTask(supabase, id, user.id, profile))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to verify access" },
      { status: 500 }
    );
  }

  let message = "";
  let link = "";
  let messageType: SubmissionMessageType = "submission";
  let files: File[] = [];
  /**
   * Files the browser already uploaded straight to storage via
   * submissions/upload-url. Anything larger than a few MB can't come through
   * this request at all — Vercel caps the body at 4.5MB — so the bytes go
   * direct and only the paths arrive here.
   */
  let pendingAttachments: Array<{
    path: string;
    filename: string;
    size: number;
    mime_type: string | null;
  }> = [];
  /** A revision may carry a new deadline for the rework. */
  let dueAt: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json({ error: "Invalid form data" }, { status: 400 });
    }
    message = String(formData.get("message") ?? "").trim();
    link = String(formData.get("link") ?? "").trim();
    const rawType = String(formData.get("message_type") ?? "submission");
    messageType = rawType as SubmissionMessageType;
    files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  } else {
    const body = await request.json().catch(() => ({}));
    dueAt = typeof body.due_at === "string" && body.due_at ? body.due_at : null;
    message = String(body.message ?? "").trim();
    link = String(body.link ?? "").trim();
    messageType = (body.message_type ?? "submission") as SubmissionMessageType;

    // Only paths under this task's own folder — the upload-url route is what
    // hands those out, and a caller must not be able to claim someone else's
    // file by naming its path here.
    const prefix = `tasks/${id}/submissions/`;
    pendingAttachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter(
        (a: unknown): a is { path: string; filename?: string; size?: number; mime_type?: string } =>
          Boolean(a) &&
          typeof (a as { path?: unknown }).path === "string" &&
          (a as { path: string }).path.startsWith(prefix)
      )
      .map((a: { path: string; filename?: string; size?: number; mime_type?: string }) => ({
        path: a.path,
        filename: String(a.filename ?? a.path.split("/").pop() ?? "attachment"),
        size: Number(a.size ?? 0),
        mime_type: a.mime_type ?? null,
      }));
  }

  // Only Admin/CEO/Founder can post review outcomes; everyone with task access
  // can submit work or append a note.
  const reviewTypes: SubmissionMessageType[] = [
    "instruction",
    "revision",
    "approval",
    "approval_reversed",
  ];
  if (reviewTypes.includes(messageType) && !canReviewSubmissions(profile)) {
    return Response.json(
      { error: `Only Admin, CEO, or Founder can post '${messageType}'` },
      { status: 403 }
    );
  }

  if (messageType !== "submission" && !message && !link) {
    return Response.json({ error: "A message is required" }, { status: 400 });
  }

  const admin = adminClient();

  const { data: task, error: taskError } = await admin
    .from("assigned_tasks")
    .select("id, category, review_required, task_name, account, project")
    .eq("id", id)
    .single();
  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // The evidence bar exists so a reviewer has something to judge. A task
  // flagged review_required = false is never read by one, so demanding 15
  // words of it is friction with no reader — it only needs to not be empty,
  // so the submission record still says something happened.
  if (messageType === "submission") {
    const fileCount = files.length + pendingAttachments.length;
    const needsEvidence = task.review_required !== false;
    const ok = needsEvidence
      ? submissionMeetsBar({ message, link, fileCount })
      : Boolean(message.trim() || link.trim() || fileCount > 0);
    if (!ok) {
      return Response.json(
        {
          error: needsEvidence
            ? `Add an attachment or a link, or describe the work in at least ${MIN_SUBMISSION_WORDS} words.`
            : "Add an attachment, a message, or a link before submitting.",
        },
        { status: 400 }
      );
    }
  }

  const { data: submission, error: insertError } = await admin
    .from("task_submissions")
    .insert({
      assigned_task_id: Number(id),
      va_task_assignment_id: null,
      user_id: user.id,
      message_type: messageType,
      due_at: dueAt,
      content: submissionSummary({
        message,
        link,
        fileCount: files.length + pendingAttachments.length,
      }),
      submission_link: link || null,
      submission_comment: message || null,
    })
    .select(SUBMISSION_SELECT)
    .single();

  if (insertError || !submission) {
    // Files the browser already put in storage have nothing to hang off now.
    if (pendingAttachments.length > 0) {
      await admin.storage.from("task-attachments").remove(pendingAttachments.map((a) => a.path));
    }
    return Response.json(
      { error: insertError?.message ?? "Unable to save submission" },
      { status: 400 }
    );
  }

  // Upload files last: if any of them fails the whole submission is rolled
  // back, so a VA never ends up with a half-recorded submission they can't
  // edit their way out of.
  const uploadedPaths: string[] = pendingAttachments.map((a) => a.path);
  try {
    // Already in storage — they only need their row.
    for (const attachment of pendingAttachments) {
      const { error: attachError } = await admin.from("assigned_task_attachments").insert({
        assigned_task_id: Number(id),
        submission_id: submission.id,
        filename: attachment.filename,
        storage_path: attachment.path,
        file_size: attachment.size || null,
        mime_type: attachment.mime_type,
        uploaded_by: user.id,
      });
      if (attachError) throw new Error(attachError.message);
    }

    for (const [index, file] of files.entries()) {
      if (file.size > 52428800) throw new Error("File too large (max 50MB)");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `tasks/${id}/submissions/${submission.id}/${Date.now()}-${index}-${safeName}`;

      const { error: uploadError } = await admin.storage
        .from("task-attachments")
        .upload(storagePath, await file.arrayBuffer(), {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPaths.push(storagePath);

      const { error: attachError } = await admin.from("assigned_task_attachments").insert({
        assigned_task_id: Number(id),
        submission_id: submission.id,
        filename: file.name,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: user.id,
      });
      if (attachError) throw new Error(attachError.message);
    }
  } catch (error) {
    await admin.from("assigned_task_attachments").delete().eq("submission_id", submission.id);
    if (uploadedPaths.length > 0) {
      await admin.storage.from("task-attachments").remove(uploadedPaths);
    }
    // The append-only rule is for VAs via RLS; the service role can still undo
    // its own failed write, which is the only case this delete covers.
    await admin.from("task_submissions").delete().eq("id", submission.id);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save attachments" },
      { status: 500 }
    );
  }

  // ── Auto-outcome ─────────────────────────────────────────────────────────
  // Some submissions never need a human decision:
  //   * Communication / Planning / Collaboration work is logged, not reviewed
  //     — it completes on submit.
  //   * A task flagged review_required = false is approved on submit, and an
  //     approval entry is written so the thread still records why it closed.
  // review_required === true always wins over the category rule above — an
  // output-based task under an account/project the Communication/Planning/
  // Collaboration auto-category rule matches (autoCategoryForTask, e.g. any
  // Virtual Concierge task filed under "Team Development") would otherwise
  // auto-complete on submit with nobody ever reviewing it, silently ignoring
  // the "Review Required: Yes" the task was explicitly created with.
  // Decided here rather than in the browser so it can't be skipped, and so the
  // approval entry can be written by the system without the caller needing
  // reviewer rights. The status move itself still goes through the client's
  // setAssignedTaskStatus, keeping one status-write path.
  let autoStatus: string | null = null;

  if (messageType === "submission" && task.review_required !== true) {
    // Reuses the row fetched for the existence check above. The previous
    // version issued a second lookup and ignored its error, so any failure
    // there silently skipped the whole auto-outcome — which is exactly how
    // tasks 314 and 315 ended up sitting in the queue.
    if (AUTO_COMPLETE_CATEGORIES.includes((task.category ?? "").trim())) {
      autoStatus = "completed";
    } else if (task.review_required === false) {
      autoStatus = "approved";
      await admin.from("task_submissions").insert({
        assigned_task_id: Number(id),
        va_task_assignment_id: null,
        user_id: user.id,
        message_type: "approval",
        content: "Auto approved — this task does not require review",
        submission_comment: "Auto approved — this task does not require review",
      });
    }
  }

  // Write the auto-outcome status here rather than leaving it to the caller.
  // The browser still moves the status for a normal submission, but an auto
  // outcome must not depend on it: a stale tab or a dropped response would
  // leave the thread saying "auto approved" while the task sat in the review
  // queue. Observed on task 313, which stayed `submitted` with no approval.
  if (autoStatus) {
    const stamp = new Date().toISOString();
    await admin
      .from("assigned_task_assignees")
      .update({ status: autoStatus, updated_at: stamp })
      .eq("assigned_task_id", id);
    await admin
      .from("assigned_tasks")
      .update({ status: autoStatus, updated_at: stamp })
      .eq("id", id);
    await syncFixedPayTaskStatus(admin, id, autoStatus);
  }

  // Only an approval somebody actually made. An approval posted from the admin
  // panel arrives here as message_type "approval"; the Telegram button calls
  // this from its own route. Congratulating from both matters, or the cheer
  // would depend on which screen the reviewer happened to use.
  //
  // Auto-approval is deliberately excluded. A task with review_required = false
  // closes on submit without anyone looking at it, so "signed off and approved,
  // well done" is congratulating a rule rather than a person — and it arrived
  // in the same breath as the submission notice, which read as the bot talking
  // to itself.
  if (messageType === "approval") {
    await cheerApproval(Number(id));
  }

  // Telegram alert on every submission, including the ones that close on
  // submit — those still represent work handed in, and Toni wants to see them
  // land. The auto-outcome is named in the message so a submission needing
  // review is still distinguishable at a glance.
  //
  // Best-effort: the submission is already committed and must not fail on a
  // Telegram problem.
  // Role-based routing: submissions notify the Founder (Toni), in-app + Telegram.
  if (messageType === "submission") {
    const { data: sProf } = await admin.from("profiles").select("full_name, username").eq("id", user.id).single();
    const submitter = sProf?.full_name || sProf?.username || "A VA";
    await notifyRecipients({
      roles: ["founder"],
      actorId: user.id,
      content: `${submitter} submitted: ${task.task_name ?? "a task"}`,
      telegramMessage: `📤 <b>New submission</b> from ${esc(submitter)}\n\nTask: ${esc(task.task_name ?? "a task")}`,
      topic: "submissions",
    });
  }

  if (messageType === "submission" && telegramEnabled("submissions")) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", user.id)
      .single();
    const who = prof?.full_name || prof?.username || "A VA";
    const where = [task.account, task.project].filter(Boolean).join(" / ");

    const outcome =
      autoStatus === "approved"
        ? "Auto approved — no review needed"
        : autoStatus === "completed"
          ? "Logged — completes on submit"
          : "Waiting for review";

    const lines = [
      `📤 <b>New submission</b> from ${mention(who, prof?.telegram_chat_id)}`,
      `Task: ${esc(task.task_name ?? "a task")}`,
    ];
    if (where) lines.push(`Project: ${esc(where)}`);
    lines.push(outcome);

    // The work itself. Most submissions here are a link rather than a file —
    // both of Flordeliz's today were — and the alert named the task without
    // ever showing what was handed in, so reviewing meant opening the admin
    // panel to find out. The buttons underneath are useless without it.
    // Only if it is actually a link. People type "N/A" in that box when there
    // is nothing to give — Flordeliz did, twice today — and "🔗 N/A" reads as
    // though something was submitted when nothing was.
    if (/^https?:\/\//i.test(link)) lines.push("", `🔗 ${esc(link)}`);
    if (message) {
      const note = message.length > 400 ? message.slice(0, 400) + "…" : message;
      lines.push("", esc(note));
    }

    // Decide from the chat. Only offered where a decision is still open —
    // auto-approved work has already closed, and putting an Approve link on it
    // would invite a tap that does nothing.
    if (!autoStatus) {
      const links = reviewLinks(Number(id));
      lines.push(
        "",
        `<a href="${links.approve}">✅ Approve</a>  •  <a href="${links.revision}">🔁 Needs revision</a>`
      );
    }
    lines.push("", "Review: https://minuteflow.click/admin");

    const sent = await sendTelegram("submissions", lines.join("\n"));

    // The submitted files themselves, under the alert. Work handed in is
    // usually judged by looking at it, and a link into the admin panel is a
    // detour when the picture could just be there.
    //
    // These live in Supabase Storage rather than Drive, so they are pulled
    // through a short-lived signed URL — the bucket is private and Telegram
    // fetching the path itself would get nothing.
    await postSubmissionFiles(admin, submission.id as number, sent.messageId);
  }

  // The team chat gets the moment, not the paperwork: who submitted and a word
  // about it, with no files, no link and no review buttons. Those belong in the
  // reviewer's chat — the team seeing work land is the point here, and the rest
  // is Toni's to act on.
  //
  // This is the only thing the bot says to the whole team that is unambiguously
  // good news. Everything else it posts there is a reminder or a warning.
  if (messageType === "submission" && telegramEnabled("team")) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, username, telegram_chat_id")
      .eq("id", user.id)
      .single();
    const who = prof?.full_name || prof?.username || "Someone";
    await sendTelegram(
      "team",
      submissionCheer(mention(who, prof?.telegram_chat_id), task.task_name)
    );
  }

  // The task's own due date moves too, so the calendar and the task editor
  // show what is expected now. Past verdicts are unaffected: a submission is
  // judged against the deadline recorded on the revision before it, not
  // against whatever the task says today. Splitting the timestamp keeps the
  // task's date and time columns in the shape the rest of the app reads.
  if (messageType === "revision" && dueAt) {
    const when = new Date(dueAt);
    if (!Number.isNaN(when.getTime())) {
      await admin
        .from("assigned_tasks")
        .update({
          due_date: dueAt.slice(0, 10),
          due_time: dueAt.slice(11, 16),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
  }

  const [withFiles] = await withAttachments(admin, [submission as never]);
  return Response.json({ submission: withFiles, autoStatus }, { status: 201 });
}

/**
 * PATCH /api/assigned-tasks/[id]/submissions?submissionId=<id>
 *
 * Correcting a saved submission. Admin/CEO/Founder only — a VA cannot edit
 * their own submission after saving, by design; they append to the thread
 * instead. The DB trigger stamps edited_at/edited_by.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();

  if (!canReviewSubmissions(profile)) {
    return Response.json(
      { error: "Only Admin, CEO, or Founder can edit a submission" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("submissionId");
  if (!submissionId) {
    return Response.json({ error: "submissionId is required" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : undefined;
  const link = typeof body.link === "string" ? body.link.trim() : undefined;

  if (message === undefined && link === undefined) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = adminClient();
  const patch: Record<string, unknown> = {};
  if (message !== undefined) {
    patch.submission_comment = message || null;
    patch.content = submissionSummary({ message, link: link ?? null, fileCount: 0 });
  }
  if (link !== undefined) patch.submission_link = link || null;
  // edited_at is stamped by the task_submissions_stamp_edit trigger. edited_by
  // is set here rather than left to the trigger's auth.uid(), which is null for
  // a service-role write — the trigger COALESCEs so this value survives.
  patch.edited_by = user.id;

  const { data, error } = await admin
    .from("task_submissions")
    .update(patch)
    .eq("id", submissionId)
    .eq("assigned_task_id", id)
    .select(SUBMISSION_SELECT)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Submission not found" }, { status: 404 });

  const [withFiles] = await withAttachments(admin, [data as never]);
  return Response.json({ submission: withFiles });
}

/**
 * DELETE /api/assigned-tasks/[id]/submissions?submissionId=<id>
 *
 * Moves a submission to trash. Never a hard delete: the row keeps its files
 * and its place in the thread, and `deleted_at` simply hides it. A submission
 * is the evidence behind a status change, so destroying one would leave the
 * task claiming work that no longer exists anywhere.
 *
 * Pass `restore=1` to bring it back.
 *
 * Admin and above only — the same tier that can review or correct one.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, department, admin_permissions")
    .eq("id", user.id)
    .single();

  if (!canReviewSubmissions(profile)) {
    return Response.json(
      { error: "Only Admin, Manager, CEO, or Founder can trash a submission" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("submissionId");
  const restore = searchParams.get("restore") === "1";
  if (!submissionId) {
    return Response.json({ error: "submissionId is required" }, { status: 400 });
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from("task_submissions")
    .update(
      restore
        ? { deleted_at: null, deleted_by: null }
        : { deleted_at: new Date().toISOString(), deleted_by: user.id }
    )
    .eq("id", submissionId)
    .eq("assigned_task_id", id)
    .select("id, deleted_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Submission not found" }, { status: 404 });

  return Response.json({ submission: data });
}
