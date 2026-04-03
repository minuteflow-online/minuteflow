/**
 * Screenshot Capture Timer Worker
 *
 * Runs in a Web Worker so timers are NOT throttled when the browser tab
 * is in the background. Sends "capture" messages back to the main thread
 * at the scheduled intervals.
 *
 * Schedule:
 *   - Immediate "start" screenshot on task begin
 *   - 3 minutes: "progress"
 *   - 9 minutes (6 min after the 3-min mark): "progress"
 *   - Then every 9 minutes consistently forever (even if inactive)
 *
 * Protocol:
 *   Main -> Worker: { type: "start", logId: number }
 *   Main -> Worker: { type: "stop" }
 *   Worker -> Main: { type: "capture", logId: number, screenshotType: string }
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

function scheduleRepeating(logId, afterMs) {
  const t = setTimeout(() => {
    if (currentLogId !== logId) return;
    requestCapture(logId, "progress");
    scheduleRepeating(logId, 540000); // Every 9 minutes
  }, afterMs);
  timers.push(t);
}

self.onmessage = function (e) {
  const { type, logId } = e.data;

  if (type === "start") {
    clearAllTimers();
    currentLogId = logId;

    // Immediate start screenshot
    requestCapture(logId, "start");

    // 3 minute progress
    const t1 = setTimeout(() => {
      requestCapture(logId, "progress");
    }, 180000); // 3 min

    // 9 minute progress (6 min after the 3-min mark)
    const t2 = setTimeout(() => {
      requestCapture(logId, "progress");
    }, 540000); // 9 min

    timers = [t1, t2];

    // After the 9-minute mark, every 9 minutes consistently
    scheduleRepeating(logId, 1080000); // 18 min = 9 + 9
  }

  if (type === "stop") {
    clearAllTimers();
    currentLogId = null;
  }
};
