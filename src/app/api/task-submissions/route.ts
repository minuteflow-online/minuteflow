import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET: List task submissions for an assignment
 *  ?va_task_assignment_id=xxx → submissions for a specific assignment
 *  ?va_id=xxx                 → all submissions for a VA's assignments
 *  (no params, admin only)    → all submissions
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { searchParams } = new URL(request.url);
  const assignmentId = searchParams.get("va_task_assignment_id");
  const vaId = searchParams.get("va_id");

  let query = supabase
    .from("task_submissions")
    .select(
      "id, va_task_assignment_id, user_id, message_type, content, submission_link, submission_comment, created_at, profiles!task_submissions_user_id_profiles_fkey(id, full_name, username, role)"
    )
    .order("created_at", { ascending: true });

  if (assignmentId) {
    query = query.eq("va_task_assignment_id", parseInt(assignmentId));
  } else if (vaId) {
    // Get all submissions for assignments belonging to this VA
    const { data: assignments } = await supabase
      .from("va_task_assignments")
      .select("id")
      .eq("va_id", vaId);
    const ids = (assignments ?? []).map((a) => a.id);
    if (ids.length === 0) {
      return Response.json({ submissions: [] });
    }
    query = query.in("va_task_assignment_id", ids);
  } else if (profile?.role !== "admin") {
    // Non-admin without filters: only their own
    const { data: assignments } = await supabase
      .from("va_task_assignments")
      .select("id")
      .eq("va_id", user.id);
    const ids = (assignments ?? []).map((a) => a.id);
    if (ids.length === 0) {
      return Response.json({ submissions: [] });
    }
    query = query.in("va_task_assignment_id", ids);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ submissions: data ?? [] });
}

/** POST: Create a new task submission
 *  Body: { va_task_assignment_id, message_type, content }
 *
 *  message_type values:
 *  - 'instruction' (admin only) — directions for the VA
 *  - 'submission' (VA only) — VA submitting work
 *  - 'revision' (admin only) — requesting changes
 *  - 'approval' (admin only) — approving the work
 *  - 'comment' (anyone) — general comment
 *
 *  Side effects:
 *  - 'submission' → sets assignment status to 'submitted'
 *  - 'revision' → sets assignment status to 'revision_needed'
 *  - 'approval' → sets assignment status to 'approved'
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";
  const body = await request.json();
  const { va_task_assignment_id, message_type, content, submission_link, submission_comment } = body;

  if (!va_task_assignment_id || !message_type || !content) {
    return Response.json(
      { error: "va_task_assignment_id, message_type, and content are required" },
      { status: 400 }
    );
  }

  // Validate message_type permissions
  const adminOnlyTypes = ["instruction", "revision", "approval"];
  if (adminOnlyTypes.includes(message_type) && !isAdmin) {
    return Response.json(
      { error: `Only admins can post '${message_type}' messages` },
      { status: 403 }
    );
  }

  if (message_type === "submission") {
    // Verify the VA owns this assignment
    const { data: assignment } = await supabase
      .from("va_task_assignments")
      .select("va_id")
      .eq("id", va_task_assignment_id)
      .single();
    if (!assignment || (assignment.va_id !== user.id && !isAdmin)) {
      return Response.json(
        { error: "You can only submit for your own assignments" },
        { status: 403 }
      );
    }
  }

  // Insert the submission
  const { data: submission, error } = await supabase
    .from("task_submissions")
    .insert({
      va_task_assignment_id,
      user_id: user.id,
      message_type,
      content,
      submission_link: submission_link || null,
      submission_comment: submission_comment || null,
    })
    .select(
      "id, va_task_assignment_id, user_id, message_type, content, submission_link, submission_comment, created_at"
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  // Update assignment status based on message_type
  const statusMap: Record<string, string> = {
    submission: "submitted",
    revision: "revision_needed",
    approval: "approved",
  };

  if (statusMap[message_type]) {
    await supabase
      .from("va_task_assignments")
      .update({ status: statusMap[message_type] })
      .eq("id", va_task_assignment_id);
  }

  return Response.json({ submission }, { status: 201 });
}
