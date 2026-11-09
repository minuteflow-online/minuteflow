import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

/** One request covers a whole gallery; more than this is not a gallery. */
const MAX_IDS = 300;

/**
 * GET /api/screenshots/meta?driveIds=a,b,c
 *
 * What the shared screenshot viewer shows around an image: who took it, the
 * task it was taken under (with account, client and category), its capture
 * type and capture time. Keyed by drive_file_id because that is the one thing
 * every page already has — every screenshot image is served as
 * /api/drive-image?id=<drive_file_id> — so the viewer can look details up
 * without each page threading them through (Toni's call, 2026-11-09).
 *
 * Any signed-in user, same as /api/drive-image: a viewer who can open the
 * image can see whose it is. Ids that aren't task screenshots (bug-report
 * captures, uploaded attachments) are simply absent from the response.
 *
 * Returns { shots: { [driveId]: { screenshot, person, log } } }.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const driveIds = Array.from(
    new Set(
      (new URL(request.url).searchParams.get("driveIds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_IDS);
  if (driveIds.length === 0) return Response.json({ shots: {} });

  const admin = serviceClient();
  const { data: rows, error } = await admin
    .from("task_screenshots")
    .select(
      "id, user_id, log_id, filename, screenshot_type, failure_reason, created_at, drive_file_id, captured_at, image_hash"
    )
    .in("drive_file_id", driveIds);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id as string)));
  const logIds = Array.from(
    new Set((rows ?? []).map((r) => r.log_id as number | null).filter((v): v is number => v != null))
  );

  const [{ data: people }, { data: logs }] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    logIds.length
      ? admin.from("time_logs").select("id, task_name, account, client_name, category").in("id", logIds)
      : Promise.resolve({
          data: [] as Array<{
            id: number;
            task_name: string | null;
            account: string | null;
            client_name: string | null;
            category: string | null;
          }>,
        }),
  ]);

  const personById = new Map((people ?? []).map((p) => [p.id as string, p]));
  const logById = new Map((logs ?? []).map((l) => [l.id as number, l]));

  const shots: Record<string, unknown> = {};
  for (const r of rows ?? []) {
    const log = r.log_id != null ? logById.get(r.log_id as number) : undefined;
    shots[r.drive_file_id as string] = {
      screenshot: r,
      person: personById.get(r.user_id as string) ?? null,
      log: log
        ? {
            task_name: log.task_name ?? null,
            account: log.account ?? null,
            client_name: log.client_name ?? null,
            category: log.category ?? null,
          }
        : null,
    };
  }
  return Response.json({ shots });
}
