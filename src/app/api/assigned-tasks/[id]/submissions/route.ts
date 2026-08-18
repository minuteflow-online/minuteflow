import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasAdminPermission } from "@/lib/adminPermissions";
import {
  canReviewSubmissions,
  submissionSummary,
  type SubmissionMessageType,
} from "@/lib/submissions";

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
    message = String(body.message ?? "").trim();
    link = String(body.link ?? "").trim();
    messageType = (body.message_type ?? "submission") as SubmissionMessageType;
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

  if (messageType === "submission" && !message && !link && files.length === 0) {
    return Response.json(
      { error: "Add an attachment, a message, or a link before submitting" },
      { status: 400 }
    );
  }
  if (messageType !== "submission" && !message && !link) {
    return Response.json({ error: "A message is required" }, { status: 400 });
  }

  const admin = adminClient();

  const { data: task, error: taskError } = await admin
    .from("assigned_tasks")
    .select("id, category, review_required")
    .eq("id", id)
    .single();
  if (taskError || !task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: submission, error: insertError } = await admin
    .from("task_submissions")
    .insert({
      assigned_task_id: Number(id),
      va_task_assignment_id: null,
      user_id: user.id,
      message_type: messageType,
      content: submissionSummary({ message, link, fileCount: files.length }),
      submission_link: link || null,
      submission_comment: message || null,
    })
    .select(SUBMISSION_SELECT)
    .single();

  if (insertError || !submission) {
    return Response.json(
      { error: insertError?.message ?? "Unable to save submission" },
      { status: 400 }
    );
  }

  // Upload files last: if any of them fails the whole submission is rolled
  // back, so a VA never ends up with a half-recorded submission they can't
  // edit their way out of.
  const uploadedPaths: string[] = [];
  try {
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
  // Decided here rather than in the browser so it can't be skipped, and so the
  // approval entry can be written by the system without the caller needing
  // reviewer rights. The status move itself still goes through the client's
  // setAssignedTaskStatus, keeping one status-write path.
  let autoStatus: string | null = null;

  if (messageType === "submission") {
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
