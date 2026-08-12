import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/assigned-tasks/[id]/screenshots
 * Read-only screenshot listing for a task's edit view (Screenshots are
 * captured during clocking on time_logs, so this only ever returns
 * results for time-based tasks that have actually been worked on).
 * Mirrors Assignment's fetchPanelScreenshots query chain: assignee log_id
 * links first, falling back to matching time_logs by user_id + task_name
 * for older tasks created before assignees carried a log_id.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const { id } = await params;
  const taskId = Number(id);

  const admin = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: taskRow } = await admin.from("assigned_tasks").select("task_name").eq("id", taskId).single();
  if (!taskRow) return Response.json({ error: "Task not found" }, { status: 404 });

  const { data: assigneeRows } = await admin
    .from("assigned_task_assignees")
    .select("log_id, va_id")
    .eq("assigned_task_id", taskId);

  const isAdminOrManager = profile?.role === "admin" || profile?.role === "manager";
  if (!isAdminOrManager) {
    const isAssignee = (assigneeRows ?? []).some((a) => a.va_id === user.id);
    if (!isAssignee) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const linkedLogIds = Array.from(
    new Set((assigneeRows ?? []).map((r) => r.log_id).filter((v): v is number => typeof v === "number"))
  );
  const vaIds = Array.from(
    new Set((assigneeRows ?? []).map((r) => r.va_id).filter((v): v is string => typeof v === "string"))
  );

  let fallbackLogIds: number[] = [];
  if (vaIds.length > 0 && taskRow.task_name) {
    const { data: timeLogs } = await admin
      .from("time_logs")
      .select("id")
      .in("user_id", vaIds)
      .eq("task_name", taskRow.task_name);
    fallbackLogIds = (timeLogs ?? []).map((r) => r.id as number);
  }

  const allLogIds = Array.from(new Set([...linkedLogIds, ...fallbackLogIds]));
  if (allLogIds.length === 0) return Response.json({ screenshots: [] });

  const { data: screenshotRows } = await admin.from("task_screenshots").select("*").in("log_id", allLogIds);
  const screenshots = (screenshotRows ?? []).map((ss) => ({
    ...ss,
    url: ss.drive_file_id ? `/api/drive-image?id=${ss.drive_file_id}` : null,
  }));

  return Response.json({ screenshots });
}
