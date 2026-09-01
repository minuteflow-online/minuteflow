import { createClient } from "@supabase/supabase-js";
import { notifyVaPrivately } from "./vaNotify";
import { sendTelegram, esc } from "./telegram";

/**
 * Flags a VA whose screen has not changed for 15 minutes while a task is running.
 *
 * It closes nothing. It used to warn and then end the session, which cost
 * Flordeliz her session on 2026-08-31 during an ordinary 41-minute gap between
 * captures — gaps that size are routine for four of the five VAs. Interrupting
 * someone's work on that evidence is not worth what it catches.
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
 *
 * For that zero-captures case, extension_heartbeats.last_seen is consulted —
 * but only to pick which message to send, never as its own trigger. That
 * heartbeat is pinged by the extension itself, independent of which browser
 * tab is focused, which is what makes it safe here in a way sessions.updated_at
 * was not: a stale extension heartbeat means the capture agent itself is not
 * running, not merely that a MinuteFlow tab is not the active one. Still,
 * silence in task_screenshots is what decides whether to act; the extension
 * heartbeat only decides what to say about it ("you look logged out" vs.
 * "connected but nothing is coming through").
 *
 * Recovery is treated as easier to prove than trouble: a single fresh capture
 * clears a standing warning immediately, before there is anywhere near enough
 * to also judge frozen-vs-moving. Being slow to notice someone is back is its
 * own kind of false positive.
 */

/** How long the screen must be unchanged before it is worth mentioning. */
const STATIC_WINDOW_MS = 15 * 60 * 1000;

/** Captures run every five minutes, so a real 15-minute window holds three or
 *  four. Fewer than three means the window is not properly covered and the
 *  check stays silent. */
const MIN_CAPTURES = 3;

/** How stale extension_heartbeats.last_seen must be before the extension
 *  itself (not the MinuteFlow tab) counts as disconnected/logged out. Matches
 *  the threshold the dashboard's own SCE banner already uses, so "offline" in
 *  a Telegram message and "offline" in the app mean the same thing. */
const EXTENSION_STALE_MS = 5 * 60 * 1000;

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

    // Loaded before any branch needs it — both the recovery-clear path and
    // the warn/close path need the profile, and this is the only place that
    // knows whose warning to touch.
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, username, telegram_chat_id, screen_static_warned_at")
      .eq("id", c.user_id)
      .single();
    if (!prof) continue;

    // Any capture at all, even just one, is evidence the extension is back —
    // clear a standing warning on the spot rather than waiting for enough
    // shots to also judge frozen-vs-moving. Detecting "they're back" should
    // be at least as quick as detecting "they went quiet," not slower: a
    // warning that lingers after someone has visibly resumed is what makes
    // this feel like it is watching for a reason to close them, not a check
    // being cautious. The stricter frozen-screen judgment below still applies
    // once there is enough to make it, on its own, later.
    if (count > 0 && count < MIN_CAPTURES) {
      if (prof.screen_static_warned_at) {
        await supabase.from("profiles").update({ screen_static_warned_at: null }).eq("id", c.user_id);
      }
      continue;
    }

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

    // The screen moved (real captures, not all identical). Clear any standing
    // warning here rather than in a sweep afterwards — this is the only place
    // that actually knows whose screen changed, and a sweep keyed on "still
    // clocked in" would leave the warning set on everyone who came back, so
    // their countdown would resume mid-way instead of starting over.
    if (!noCaptures && !frozen) {
      if (prof.screen_static_warned_at) {
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

    // Only meaningful for the zero-captures case: the extension pings its own
    // heartbeat independently of any MinuteFlow tab, so a stale-or-missing row
    // here means the extension itself looks logged out or not running — a
    // more specific, more actionable thing to tell someone than "nothing is
    // arriving." A frozen-but-connected screen already has captures, so this
    // is never consulted for that case.
    let extensionLoggedOut = false;
    if (noCaptures) {
      const { data: ext } = await supabase
        .from("extension_heartbeats")
        .select("last_seen")
        .eq("user_id", c.user_id)
        .maybeSingle();
      extensionLoggedOut =
        !ext?.last_seen || Date.now() - new Date(ext.last_seen as string).getTime() > EXTENSION_STALE_MS;
    }

    // Nothing arriving while the extension is checking in normally is a fault
    // on our side of the wire, not theirs. Telling someone to go and check an
    // extension that is plainly connected — as it did to Flordeliz, twice,
    // while her extension showed "Connected" and seven captures — reads as
    // being blamed for our bug. Toni hears about it; the VA does not.
    if (noCaptures && !extensionLoggedOut) {
      await supabase
        .from("profiles")
        .update({ screen_static_warned_at: new Date().toISOString() })
        .eq("id", c.user_id);

      if (!warnedAt) {
        await sendTelegram(
          "ops",
          [
            `📡 <b>${esc(who)}</b> — captures stopped arriving`,
            "",
            `Nothing for ${Math.round(STATIC_WINDOW_MS / 60000)} minutes, but the extension is still checking in. That points at the upload path rather than at her.`,
            "",
            "No message was sent to her and her session was left alone.",
          ].join("\n")
        );
      }
      flagged.push(who);
      continue;
    }

    // First time we see this stretch: say something, close nothing.
    if (!warnedAt) {
      await supabase
        .from("profiles")
        .update({ screen_static_warned_at: new Date().toISOString() })
        .eq("id", c.user_id);

      // Worded as a prompt, not an accusation. Every case here has plenty of
      // innocent explanations — reading, a call, a second monitor, a signed-out
      // extension — and the useful thing is for them to check and decide, not
      // to be told they are idle.
      await notifyVaPrivately({
        chatId: prof.telegram_chat_id as number | null,
        userId: c.user_id,
        vaName: who,
        topic: "Screen activity",
        // Reaching here with noCaptures means the extension itself stopped
        // checking in, so there is genuinely something on their end to look at.
        // The connected-but-silent case never gets this far — it went to ops.
        message: noCaptures
          ? [
              "🖥️ <b>You look logged out of the extension</b>",
              "",
              `Hi ${esc(who)} — MinuteFlow has not received any screenshots in the last ${Math.round(STATIC_WINDOW_MS / 60000)} minutes, and your extension has not checked in either.`,
              "",
              "Please open the MinuteFlow extension and make sure you are logged in — that is the most common cause.",
              "",
              "Your session is still running and nothing has been changed.",
            ].join("\n")
          : [
              "🖥️ <b>Quick check on your screenshots</b>",
              "",
              `Hi ${esc(who)} — your last few captures look identical, so MinuteFlow cannot tell whether your screen is being recorded properly.`,
              "",
              "Could you open MinuteFlow and check your screenshots are going through — and that you're still logged into the extension? If you have stepped away, a break or a clock-out keeps your log accurate.",
              "",
              "Your session is still running and nothing has been changed.",
            ].join("\n"),
      });

      flagged.push(who);
      continue;
    }

    // Warned already. Nothing further happens: the warning stands, Toni can
    // see who is flagged, and the session is left to run. Ending someone's
    // shift on a stretch of quiet is the one thing this must not do.
    flagged.push(who);
  }

  return flagged;
}

