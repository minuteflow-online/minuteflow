// Automatic 5-minute screen capture while clocked in — desktop's equivalent
// of the Chrome extension's background.js (runScheduledCapture/idleReason).
// Deliberately simplified from the extension's version: no local-first
// retry queue, no offline-upload alarm. The extension needs that because a
// browser service worker can be killed and restarted unpredictably; this
// app's main process keeps running in the tray for as long as the VA is
// signed in, so a tick that fails to upload just tries again at the next
// one, same as a missed chrome.alarms firing a few minutes later would.
import { captureAndUploadScreenshot } from "./screenshot";
import { API_BASE } from "./config";

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

// No keyboard/mouse input for this long counts as idle — matched to the
// capture interval itself, same reasoning as the extension's
// IDLE_THRESHOLD_SECONDS: an "idle" marker should mean idle for the whole
// slot, not merely idle the instant the timer happened to fire.
const IDLE_THRESHOLD_SECONDS = 300;

/** Records why a capture slot has no screenshot — no image, just a reason
 *  and a timestamp, same /api/screenshot-marker endpoint the extension uses.
 *  Best-effort: a failed marker just leaves one slot's gap unexplained;
 *  nothing here should be able to interrupt the next tick. */
async function recordMarker(userId: string, logId: number, failureReason: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/screenshot-marker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        logId,
        failureReason,
        capturedAt: new Date().toISOString(),
      }),
    });
  } catch {
    // Network blip or the server being briefly unreachable — nothing to
    // retry here, the next scheduled tick in 5 minutes covers it.
  }
}

export interface AutoCaptureTick {
  userId: string;
  isOnBreak: boolean;
  /** The task currently being tracked, if any — null means clocked in with
   *  nothing started yet, which the extension also leaves unrecorded rather
   *  than attempting a marker with no task to attach it to. */
  activeLogId: number | null;
}

async function runCaptureTick(tick: AutoCaptureTick): Promise<void> {
  // Time away from work — the extension records nothing for a break either,
  // and photographing someone's screen through one isn't this app's job.
  if (tick.isOnBreak) return;

  if (!tick.activeLogId) return;

  const idleState = await window.mfDesktop.getIdleState(IDLE_THRESHOLD_SECONDS);
  if (idleState === "idle") {
    await recordMarker(tick.userId, tick.activeLogId, "Computer idle");
    return;
  }
  if (idleState === "locked") {
    await recordMarker(tick.userId, tick.activeLogId, "Screen locked");
    return;
  }

  const result = await captureAndUploadScreenshot({
    userId: tick.userId,
    logId: tick.activeLogId,
    screenshotType: "progress",
  });
  if (!result.ok) {
    await recordMarker(tick.userId, tick.activeLogId, result.error || "Screen could not be captured");
  }
}

/** Starts the 5-minute capture loop. `getTick` is called fresh on every
 *  tick (not just once at start) so the loop always sees the VA's current
 *  break/task state rather than a stale snapshot from whenever the caller's
 *  effect happened to run — the caller should back it with a ref, the same
 *  pattern userIdRef/sessionRow tracking already uses elsewhere in App.tsx.
 *  Returns a function that stops the loop. */
export function startAutoCapture(getTick: () => AutoCaptureTick | null): () => void {
  const id = setInterval(() => {
    const tick = getTick();
    if (!tick) return;
    void runCaptureTick(tick);
  }, CAPTURE_INTERVAL_MS);
  return () => clearInterval(id);
}
