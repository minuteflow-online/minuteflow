/**
 * Screenshot Capture Timer Worker
 *
 * Runs in a Web Worker so timers are NOT throttled when the browser tab
 * is in the background. Sends "capture" messages back to the main thread
 * at the scheduled intervals.
 *
 * Schedule:
 *   - Immediate "start" screenshot on task begin
 *   - 3 min → screenshot
 *   - 9 min → screenshot
 *   - Every 9 min after that
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

    // 3 min screenshot
    const t3 = setTimeout(() => {
      if (currentLogId !== logId) return;
      requestCapture(logId, "progress");

      // 9 min screenshot (6 min after the 3-min one)
      const t9 = setTimeout(() => {
        if (currentLogId !== logId) return;
        requestCapture(logId, "progress");

        // Every 9 min after that
        scheduleRepeating(logId, 540000); // 9 min
      }, 360000); // 6 min after 3-min = 9 min total
      timers.push(t9);
    }, 180000); // 3 min
    timers.push(t3);
  }

  if (type === "stop") {
    clearAllTimers();
    currentLogId = null;
  }
};
