import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

/**
 * POST /api/assigned-tasks/reorder
 *
 * Lets a VA (or anyone with their own assignee rows — admins have these too
 * when they're on a task themselves) set a personal display order for their
 * assigned tasks on the dashboard, by dragging tiles in AssignedTasksWidget.
 *
 * Writes ONLY `assigned_task_assignees.sort_order`. It never touches status,
 * dates, log_id, or anything else the calendar, submissions, or payroll
 * flows read — so reordering can't affect any of them.
 *
 * Body: { orderedIds: number[] } — assigned_task_assignees.id values, in the
 * desired display order. Every id must belong to the caller (va_id = self);
 * a foreign or stale id fails the whole request rather than partially
 * applying, so a tampered payload can't move someone else's task around.
 */
export async function POST(request: Request) {
  // Bearer-token fallback for the desktop app, same as PATCH
  // /api/assigned-tasks/[id] — see that route's comment and
  // src/lib/supabase/server.ts's createClient() doc for why. Additive: a web
  // request never sends this header, so the cookie-based path is unaffected.
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const supabase = await createClient(bearerToken);
  const {
    data: { user },
  } = await supabase.auth.getUser(bearerToken);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const orderedIds = (body as { orderedIds?: unknown } | null)?.orderedIds;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return Response.json({ error: "orderedIds is required" }, { status: 400 });
  }
  if (!orderedIds.every((id): id is number => Number.isInteger(id))) {
    return Response.json({ error: "orderedIds must be integers" }, { status: 400 });
  }

  // Service-role client: a permission-granted plain VA's row still needs to
  // be reachable the same way every other assignee-row write in this API
  // goes through the admin client, and the ownership check just below is
  // what keeps this safe rather than RLS.
  const adminSupabase = createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: owned, error: ownedError } = await adminSupabase
    .from("assigned_task_assignees")
    .select("id")
    .in("id", orderedIds)
    .eq("va_id", user.id);

  if (ownedError) return Response.json({ error: ownedError.message }, { status: 500 });

  const ownedIds = new Set((owned ?? []).map((r) => r.id as number));
  if (orderedIds.some((id) => !ownedIds.has(id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const results = await Promise.all(
    orderedIds.map((id, index) =>
      adminSupabase.from("assigned_task_assignees").update({ sort_order: index }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });

  return Response.json({ ok: true });
}
