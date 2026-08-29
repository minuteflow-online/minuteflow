import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { hasFinancialAccess } from "@/lib/financialAccess";
import { restoreLog, upholdLog, flagLog } from "@/lib/timeLogReview";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The review room's data.
 *
 * GET  — everything currently held or flagged, newest first.
 * POST — flag one entry by hand.
 * PATCH — put a held entry back, or confirm it stays.
 *
 * Financial access only. These rows say what somebody is not being paid for
 * and why, alongside whatever they wrote appealing it.
 */

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireFinance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, role, department")
    .eq("id", user.id)
    .single();
  if (!hasFinancialAccess(profile)) {
    return {
      error: Response.json(
        {
          error: "Forbidden",
          signedInAs: profile?.full_name ?? profile?.username ?? "(no profile row found)",
          role: profile?.role ?? null,
        },
        { status: 403 }
      ),
    };
  }
  return { userId: user.id };
}

export async function GET(request: NextRequest) {
  const auth = await requireFinance();
  if (auth.error) return auth.error;

  // Open items by default. Settled ones are still readable, but a room that
  // shows every entry ever set aside stops being a to-do list.
  const state = request.nextUrl.searchParams.get("state");
  const states = state ? [state] : ["held", "flagged"];

  const { data, error } = await admin()
    .from("time_log_reviews")
    .select(
      "id, log_id, user_id, state, source, finding_type, reason, original_billable, created_at, notified_at, appeal_text, appeal_at, resolved_at, resolution_note, profiles!time_log_reviews_user_id_fkey(full_name, username), time_logs(task_name, category, billable, start_time, end_time, duration_ms, session_date)"
    )
    .in("state", states)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ reviews: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireFinance();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    logId?: number;
    reason?: string;
  };
  if (!body.logId || !body.reason?.trim()) {
    return Response.json({ error: "Need logId and reason" }, { status: 400 });
  }

  const supabase = admin();
  const { data: log } = await supabase
    .from("time_logs")
    .select("id, user_id")
    .eq("id", body.logId)
    .maybeSingle();
  if (!log) return Response.json({ error: "That entry no longer exists." }, { status: 404 });

  const result = await flagLog(supabase, {
    logId: body.logId,
    userId: log.user_id as string,
    source: "manual",
    findingType: "manual",
    reason: body.reason.trim(),
    createdBy: auth.userId,
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, reviewId: result.reviewId });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFinance();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    reviewId?: number;
    action?: "restore" | "uphold";
    note?: string;
  };
  if (!body.reviewId || (body.action !== "restore" && body.action !== "uphold")) {
    return Response.json({ error: "Need reviewId and action restore|uphold" }, { status: 400 });
  }

  const supabase = admin();
  const result =
    body.action === "restore"
      ? await restoreLog(supabase, body.reviewId, auth.userId!, body.note)
      : await upholdLog(supabase, body.reviewId, auth.userId!, body.note);

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
