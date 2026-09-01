import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * True when an insert failed because a column doesn't exist on the table.
 * Same check /api/upload-screenshot uses — captured_at is newer than both
 * routes, and a table that hasn't picked up the column yet must not lose the
 * marker over it.
 */
function isMissingColumnError(err: { code?: string; message?: string }): boolean {
  if (err.code === "PGRST204" || err.code === "42703") return true;
  return (err.message || "").toLowerCase().includes("captured_at");
}

/**
 * POST /api/screenshot-marker
 *
 * Records *why* a capture slot has no screenshot (idle, locked, on a
 * MinuteFlow tab) — no image involved, just a row on task_screenshots.
 *
 * task_screenshots intentionally has no anon/authenticated grants (see the
 * REVOKE statements already applied in production) — every write to it goes
 * through a service-role server route. The extension used to insert markers
 * directly with the signed-in VA's own token, which that lockdown correctly
 * rejects with 42501 every time, forever (it retries on a 30s alarm). This
 * route is the marker's equivalent of /api/upload-screenshot: same table,
 * same service-role path, just without a Drive upload in front of it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const userId = body?.userId as string | undefined;
    const logId = body?.logId as string | number | undefined;
    const failureReason = body?.failureReason as string | undefined;
    const capturedAtRaw = body?.capturedAt as string | undefined;

    if (!userId || !logId || !failureReason) {
      return Response.json(
        { error: "Missing required fields: userId, logId, failureReason" },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const baseRow = {
      user_id: userId,
      log_id: Number(logId),
      screenshot_type: "failed" as const,
      failure_reason: failureReason,
      filename: "",
    };

    const capturedAt =
      capturedAtRaw && !isNaN(Date.parse(capturedAtRaw)) ? new Date(capturedAtRaw) : new Date();

    let { error } = await supabase
      .from("task_screenshots")
      .insert({ ...baseRow, captured_at: capturedAt.toISOString() });

    if (error && isMissingColumnError(error)) {
      ({ error } = await supabase.from("task_screenshots").insert(baseRow));
    }

    if (error) {
      return Response.json({ error: "DB insert failed", details: error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Marker insert failed", details: message }, { status: 500 });
  }
}
