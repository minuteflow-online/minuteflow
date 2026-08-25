import { createClient } from "@supabase/supabase-js";

/**
 * What the unchanged-screen check can see right now, without acting on it.
 *
 * Exists because "is it working?" kept being unanswerable. Silence from the
 * check is the correct output on a normal day and also exactly what a broken
 * check produces, and telling those apart meant waiting for a real case and
 * hoping. This shows the inputs and the verdict for every person on the clock,
 * so the question takes five seconds instead of a day.
 *
 * Reads only. Nothing here warns anyone, closes anything or writes a row.
 */

/** Kept in step with lib/staticScreen — these are the thresholds it applies. */
const STATIC_WINDOW_MS = 15 * 60 * 1000;
const MIN_CAPTURES = 3;
const OFF_DUTY_CATEGORIES = ["Personal", "Break"];

export type ScreenCheckRow = {
  name: string;
  category: string | null;
  onBreak: boolean;
  captures: number;
  distinctHashes: number;
  spanMinutes: number;
  verdict: string;
  wouldWarn: boolean;
};

export async function staticScreenReport(): Promise<ScreenCheckRow[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: sessions } = await supabase
    .from("sessions")
    .select("user_id, active_task")
    .eq("clocked_in", true)
    .not("active_task", "is", null);

  const since = new Date(Date.now() - STATIC_WINDOW_MS).toISOString();
  const rows: ScreenCheckRow[] = [];

  for (const s of sessions ?? []) {
    const task = s.active_task as { category?: string; isBreak?: boolean } | null;
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", s.user_id)
      .single();
    const name = prof?.full_name || prof?.username || "Someone";

    const { data: shots } = await supabase
      .from("task_screenshots")
      .select("image_hash, created_at")
      .eq("user_id", s.user_id)
      .not("image_hash", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    const captures = shots?.length ?? 0;
    const distinct = new Set((shots ?? []).map((x) => x.image_hash as string)).size;
    const spanMs =
      captures > 1
        ? new Date(shots![captures - 1].created_at as string).getTime() -
          new Date(shots![0].created_at as string).getTime()
        : 0;

    const onBreak = Boolean(task?.isBreak);
    const category = task?.category ?? null;

    // Mirrors the order the real check applies its rules, so a verdict here
    // explains the silence there rather than merely agreeing with it.
    let verdict: string;
    let wouldWarn = false;
    if (onBreak || OFF_DUTY_CATEGORIES.includes(category ?? "")) {
      verdict = "skipped — on break or personal time";
    } else if (captures < MIN_CAPTURES) {
      verdict = `cannot tell — only ${captures} capture${captures === 1 ? "" : "s"} with a hash`;
    } else if (spanMs < STATIC_WINDOW_MS * 0.8) {
      verdict = "cannot tell — captures do not span the full window";
    } else if (distinct === 1) {
      verdict = "WOULD WARN — every capture identical";
      wouldWarn = true;
    } else {
      verdict = `working — ${distinct} different screens`;
    }

    rows.push({
      name,
      category,
      onBreak,
      captures,
      distinctHashes: distinct,
      spanMinutes: Math.round((spanMs / 60000) * 10) / 10,
      verdict,
      wouldWarn,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
