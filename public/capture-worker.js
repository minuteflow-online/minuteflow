/**
 * Screenshot Capture Timer Worker
 *
 * Runs in a Web Worker so timers are NOT throttled when the browser tab
 * is in the background. Sends "capture" messages back to the main thread
 * at the scheduled intervals.
 *
 * Schedule:
 *   - Immediate "start" screenshot on task begin
 *   - Every 10 minutes consistently after that
 *
 * Protocol:
 *   Main -> Worker: { type: "start", logId: number }
 *   Main -> Worker: { type: "stop" }
 *   Worker -> Main: { type: "capture", logId: number, screenshotType: string }
 *   Worker -> Main: { type: "capture_failed", logId: number, reason: string }
 */

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

    // Immediate start screenshot
    requestCapture(logId, "start");

    // Every 10 minutes consistently
    scheduleRepeating(logId, 600000); // 10 min
  }

  if (type === "stop") {
    clearAllTimers();
    currentLogId = null;
  }
};
