import { createClient } from "@supabase/supabase-js";
import { notifyVaPrivately } from "./vaNotify";
import { forceClockOut } from "./forceClockOut";
import { esc } from "./telegram";

/**
 * Flags a VA whose screen has not changed for 15 minutes while a task is running,
 * then closes the session if it still has not changed 15 minutes after that.
 *
 * This catches something the heartbeat cannot. A tab left open keeps the session
 * alive, so someone can look perfectly active to the idle check while their
 * screen has not moved at all. Comparing the captures themselves is the only
 * way to tell those apart.
 *
 * Compares task_screenshots.image_hash, which the extension already computes
 * on every capture and which the admin screenshot grid already uses to show
 * its "Unchanged" badge. An earlier version fetched MD5s from Google Drive
 * instead — slower, and it failed closed: one slow Drive call made the whole
 * check give up silently, which is why it never fired.
 *
 * Deliberately conservative. Every ambiguous case is treated as "cannot tell"
 * and skipped: too few captures, or a window that does not actually span the
 * period. Rows without a hash are excluded by the query rather than counted as
 * matching, so an older extension build cannot make someone look idle.
 *
 * One case is not ambiguous: ZERO captures in a full window, on a task that
 * has itself been running that whole window. That is not "not enough evidence
 * yet" — it is the extension having nothing to show for 15 straight minutes on
 * a task old enough to have produced several. It gets its own warn-then-close
 * path below, worded for "nothing is arriving" rather than "the screen froze,"
 * since the likely cause (extension crashed, screen-share dropped, signed out)
 * is different from a frozen-but-connected capture.
 */

/** How long the screen must be unchanged before it is worth mentioning. */
const STATIC_WINDOW_MS = 15 * 60 * 1000;

/** How long after that message the person has to do something before the
 *  session is closed. Any change on screen in between cancels it entirely. */
const GRACE_MS = 15 * 60 * 1000;

/** Captures run every five minutes, so a real 15-minute window holds three or
 *  four. Fewer than three means the window is not properly covered and the
 *  check stays silent. */
const MIN_CAPTURES = 3;

/** Same switch the idle check uses. Both automatic closes are off until turned
 *  on deliberately — see the note in the idle cron for why. */
const AUTO_CLOSE_ENABLED = process.env.IDLE_AUTO_CLOSE === "on";

type Candidate = {
  user_id: string;
  category: string | null;
  isBreak: boolean;
  log_id: number | null;
  /** Start time of the currently active task, if known. Used only to decide
   *  whether a full window has actually elapsed since it began — a task two
   *  minutes old having zero captures is normal, not a warning. */
  logStartTime: string | null;
};

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
  const closed: string[] = [];
  const since = new Date(Date.now() - STATIC_WINDOW_MS).toISOString();

  for (const c of candidates) {
    // A still screen is the expected state on a break or during personal time.
    if (c.isBreak || exemptCategories.includes(c.category ?? "")) continue;

    const { data: shots, error } = await supabase
      .from("task_screenshots")
      .select("image_hash, created_at")
      .eq("user_id", c.user_id)
      .not("image_hash", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) continue;
    const count = shots?.length ?? 0;

    // Zero captures is only meaningful once the current task has actually
    // been running the full window — a task started two minutes ago having
    // zero captures so far is normal, not a warning.
    const taskOldEnough =
      c.logStartTime != null && Date.now() - new Date(c.logStartTime).getTime() >= STATIC_WINDOW_MS;
    const noCaptures = count === 0 && taskOldEnough;

    let frozen = false;
    if (!noCaptures) {
      if (count < MIN_CAPTURES) continue;

      // The captures must actually span the window. A burst of three uploads
      // two minutes ago says nothing about the fifteen minutes before them.
      const first = new Date(shots![0].created_at as string).getTime();
      const last = new Date(shots![shots!.length - 1].created_at as string).getTime();
      if (last - first < STATIC_WINDOW_MS * 0.8) continue;

      const checksums = shots!.map((s) => s.image_hash as string);
      frozen = new Set(checksums).size === 1;
    }

    // Loaded before the comparison because both outcomes need it — a moved
    // screen has to clear this person's standing warning, not just a still one.
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id, screen_static_warned_at")
      .eq("id", c.user_id)
      .single();
    if (!prof) continue;

    // The screen moved (real captures, not all identical). Clear any standing
    // warning here rather than in a sweep afterwards — this is the only place
    // that actually knows whose screen changed, and a sweep keyed on "still
    // clocked in" would leave the warning set on everyone who came back, so
    // their countdown would resume mid-way instead of starting over.
    if (!noCaptures && !frozen) {
      if (prof?.screen_static_warned_at) {
        await supabase
          .from("profiles")
          .update({ screen_static_warned_at: null })
          .eq("id", c.user_id);
      }
      continue;
    }

    const who = (prof.full_name as string) || (prof.username as string) || "Someone";
    const warnedAt = prof.screen_static_warned_at
      ? new Date(prof.screen_static_warned_at as string).getTime()
      : null;

    // First time we see this stretch: say something, close nothing.
    if (!warnedAt) {
      await supabase
        .from("profiles")
        .update({ screen_static_warned_at: new Date().toISOString() })
        .eq("id", c.user_id);

      // Worded as a prompt, not an accusation. Either case has plenty of
      // innocent explanations — reading, a call, a second monitor, an
      // extension that needs a reshare — and the useful thing is for them to
      // check and decide, not to be told they are idle.
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id as number | null,
        userId: c.user_id,
        vaName: who,
        topic: "Screen activity",
        message: noCaptures
          ? [
              "🖥️ <b>No screenshots detected</b>",
              "",
              `Hi ${esc(who)} — MinuteFlow has not received any screenshots from your session in the last ${Math.round(STATIC_WINDOW_MS / 60000)} minutes.`,
              "",
              "This usually means the extension lost connection or your screen-share stopped. Could you open MinuteFlow and check?",
              "",
              `If nothing changes in ${Math.round(GRACE_MS / 60000)} minutes the session will close on its own, and the time can always be corrected afterwards.`,
            ].join("\n")
          : [
              "🖥️ <b>Quick check on your screenshots</b>",
              "",
              `Hi ${esc(who)} — your last few captures look identical, so MinuteFlow cannot tell whether your screen is being recorded properly.`,
              "",
              "Could you open MinuteFlow and check your screenshots are going through? If you have stepped away, a break or a clock-out keeps your log accurate.",
              "",
              `If nothing changes in ${Math.round(GRACE_MS / 60000)} minutes the session will close on its own, and the time can always be corrected afterwards.`,
            ].join("\n"),
      });

      flagged.push(who);
      continue;
    }

    // Warned already and still nothing resolved — close it, but only if the
    // warning could actually have reached them. Someone with no Telegram link
    // never saw it, and closing a session on a warning nobody received is the
    // unfairness this whole flow exists to avoid. They stay flagged for Toni
    // instead, which is visible without being punitive.
    if (Date.now() - warnedAt >= GRACE_MS && prof.telegram_chat_id && AUTO_CLOSE_ENABLED) {
      await forceClockOut(c.user_id, c.log_id, noCaptures ? "no_screenshots" : "screen_unchanged");
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id as number | null,
        userId: c.user_id,
        vaName: who,
        topic: "Screen activity",
        message: [
          "⚪ <b>Session closed</b>",
          "",
          noCaptures
            ? "No screenshots came through after the check, so MinuteFlow ended the session and closed the open task."
            : "Your screen stayed the same after the check, so MinuteFlow ended the session and closed the open task.",
          "If you were working, tell Toni — the time can be put back.",
        ].join("\n"),
      });
      closed.push(who);
      continue;
    }

    flagged.push(who);
  }

  return [...flagged, ...closed];
}

