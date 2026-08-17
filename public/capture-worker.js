/**
 * Screenshot Capture Timer Worker
 *
 * Runs in a Web Worker so timers are NOT throttled when the browser tab
 * is in the background. Sends "capture" messages back to the main thread
 * at the scheduled intervals.
 *
 * Schedule:
 *   - Immediate "start" screenshot on task begin
 *   - Every 5 min after that
 *
 * Kept in step with CAPTURE_INTERVAL_MINUTES in extension/background.js. The
 * extension owns capture whenever it's installed; this worker only drives the
 * in-page fallback for VAs without it.
 *
 * Protocol:
 *   Main -> Worker: { type: "start", logId: number }
 *   Main -> Worker: { type: "stop" }
 *   Worker -> Main: { type: "capture", logId: number, screenshotType: string }
 *   Worker -> Main: { type: "capture_failed", logId: number, reason: string }
 */

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

let currentLogId = null;
let timers = [];

function clearAllTimers() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

function requestCapture(logId, screenshotType) {
  if (currentLogId !== logId) return; // Task changed, skip
  self.postMessage({ type: "capture", logId, screenshotType });
}

function scheduleRepeating(logId, intervalMs) {
  const t = setTimeout(() => {
    if (currentLogId !== logId) return;
    requestCapture(logId, "progress");
    scheduleRepeating(logId, intervalMs); // Keep repeating at same interval
  }, intervalMs);
  timers.push(t);
}

self.onmessage = function (e) {
  const { type, logId } = e.data;

  if (type === "start") {
    clearAllTimers();
    currentLogId = logId;

    // Immediate start screenshot, then one every 5 minutes
    requestCapture(logId, "start");
    scheduleRepeating(logId, CAPTURE_INTERVAL_MS);
  }

  if (type === "stop") {
    clearAllTimers();
    currentLogId = null;
  }
};
