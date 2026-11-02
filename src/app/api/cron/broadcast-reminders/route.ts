import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { remindPendingBroadcast, reminderDue } from "@/lib/broadcastReminders";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/broadcast-reminders
 * Hourly cron: remind everyone who hasn't acknowledged a published broadcast,
 * 12 hours after it was published and every 24 hours after that, until no one
 * is left. "Published" is the last save — re-saving a published broadcast
 * sends it out again, so the reminder clock restarts with it.
 * Secured by CRON_SECRET (set in Vercel env + vercel.json crons).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: broadcasts, error } = await admin
    .from("broadcasts")
    .select("id, title, category, require_word, created_by, created_at, updated_at")
    .eq("status", "published");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const results: { id: string; reminded: number }[] = [];

  for (const b of broadcasts || []) {
    const publishedAt = new Date(b.updated_at || b.created_at).getTime();
    const hours = (now - publishedAt) / 3_600_000;
    if (!reminderDue(hours)) continue;
    const reminded = await remindPendingBroadcast(admin, b, b.created_by);
    results.push({ id: b.id, reminded });
  }

  return Response.json({ checked: broadcasts?.length ?? 0, results });
}
