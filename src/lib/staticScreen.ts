import { createClient } from "@supabase/supabase-js";
import { driveChecksum } from "./driveFetch";
import { notifyVaPrivately } from "./vaNotify";

/**
 * Flags a VA whose screen has not changed for 20 minutes while a task is running.
 *
 * This catches something the heartbeat cannot. A tab left open keeps the session
 * alive, so someone can look perfectly active to the idle check while their
 * screen has not moved at all. Comparing the captures themselves is the only
 * way to tell those apart.
 *
 * Drive computes an MD5 on upload, so identical screenshots compare as equal
 * without downloading anything — a metadata call per capture rather than an
 * image transfer per capture, which is what makes this affordable on a cron.
 *
 * Deliberately conservative. Every ambiguous case is treated as "cannot tell"
 * and skipped: a missing checksum, too few captures, or a window that does not
 * actually span the full period. Accusing someone of idling because Drive was
 * briefly unreachable is far worse than missing one genuine case.
 */

/** How long the screen must be unchanged before it is worth mentioning. */
const STATIC_WINDOW_MS = 20 * 60 * 1000;

/** Captures run every five minutes, so a real 20-minute window holds four or
 *  five. Fewer than three means the window is not properly covered and the
 *  check stays silent. */
const MIN_CAPTURES = 3;

/** One warning per stretch. Cleared as soon as the screen moves again, so a VA
 *  who comes back and goes quiet later is warned afresh rather than never. */
const REWARN_AFTER_MS = 60 * 60 * 1000;

type Candidate = { user_id: string; category: string | null; isBreak: boolean };

/** Built here rather than passed in: the Supabase client type does not survive
 *  crossing a module boundary cleanly, and this is a cron with no request to
 *  borrow a client from anyway. */
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function checkStaticScreens(
  candidates: Candidate[],
  exemptCategories: string[]
): Promise<string[]> {
  const supabase = serviceClient();
  const flagged: string[] = [];
  const since = new Date(Date.now() - STATIC_WINDOW_MS).toISOString();

  for (const c of candidates) {
    // A still screen is the expected state on a break or during personal time.
    if (c.isBreak || exemptCategories.includes(c.category ?? "")) continue;

    const { data: shots, error } = await supabase
      .from("task_screenshots")
      .select("drive_file_id, created_at")
      .eq("user_id", c.user_id)
      .not("drive_file_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error || !shots || shots.length < MIN_CAPTURES) continue;

    // The captures must actually span the window. A burst of three uploads two
    // minutes ago says nothing about the twenty minutes before them.
    const first = new Date(shots[0].created_at as string).getTime();
    const last = new Date(shots[shots.length - 1].created_at as string).getTime();
    if (last - first < STATIC_WINDOW_MS * 0.8) continue;

    const checksums = await Promise.all(
      shots.map((s) => driveChecksum(s.drive_file_id as string))
    );
    // Any unreadable checksum makes the comparison meaningless.
    if (checksums.some((h) => !h)) continue;
    if (new Set(checksums).size !== 1) continue;

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id, screen_static_warned_at")
      .eq("id", c.user_id)
      .single();
    if (!prof) continue;

    const warnedAt = prof.screen_static_warned_at
      ? new Date(prof.screen_static_warned_at as string).getTime()
      : null;
    if (warnedAt && Date.now() - warnedAt < REWARN_AFTER_MS) continue;

    const who = (prof.full_name as string) || (prof.username as string) || "Someone";
    await supabase
      .from("profiles")
      .update({ screen_static_warned_at: new Date().toISOString() })
      .eq("id", c.user_id);

    await notifyVaPrivately({
      chatId: prof.telegram_chat_id as number | null,
      vaName: who,
      topic: "Screen activity",
      message: [
        "🖥️ <b>Your screen has not changed in 20 minutes</b>",
        "",
        "A task is still running, so your time is being recorded against it.",
        "If you have stepped away, take a break or clock out so the time is not billed as work.",
        "If you are working, carry on — this is only a heads-up.",
      ].join("\n"),
    });

    flagged.push(who);
  }

  return flagged;
}

/** Clears the marker for anyone whose screen has moved since, so the next quiet
 *  stretch is treated on its own rather than suppressed by an old warning. */
export async function clearStaticFlags(stillFlagged: string[]): Promise<void> {
  const supabase = serviceClient();
  let query = supabase
    .from("profiles")
    .update({ screen_static_warned_at: null })
    .not("screen_static_warned_at", "is", null);
  if (stillFlagged.length > 0) query = query.not("id", "in", `(${stillFlagged.join(",")})`);
  await query;
}
