import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { hasBroadAdminAccess } from "@/lib/financialAccess";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/task-screenshots/delete
 *
 * Deletes one screenshot (`id`) or every screenshot on a log (`logId`) —
 * ActivityLog's admin-only "delete screenshot" and "delete entry" actions.
 *
 * task_screenshots intentionally has no anon/authenticated grants (every
 * write goes through a service-role route) — both call sites were calling
 * `.delete()` with the signed-in admin's own client, which that lockdown
 * rejects with 42501 every time. The failure was never surfaced (no error
 * check on either call site) and the UI proceeded as if it had worked, so a
 * deleted entry's screenshots silently stayed in the database, orphaned
 * once the time_log itself was gone. This route is that action's actual
 * write path — same table, same service-role pattern as
 * /api/screenshot-marker and /api/upload-screenshot.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !hasBroadAdminAccess(profile)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id as number | undefined;
  const logId = body?.logId as number | undefined;

  if (!id && !logId) {
    return Response.json({ error: "Provide either id or logId" }, { status: 400 });
  }

  const admin = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const query = admin.from("task_screenshots").delete();
  const { error } = id ? await query.eq("id", id) : await query.eq("log_id", logId!);

  if (error) {
    return Response.json({ error: "Delete failed", details: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
