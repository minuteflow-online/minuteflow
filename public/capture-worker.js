/**
 * Screenshot Capture Timer Worker
 *
 * Runs in a Web Worker so timers are NOT throttled when the browser tab
 * is in the background. Sends "capture" messages back to the main thread
 * at the scheduled intervals.
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

function scheduleRandom(logId, afterMs) {
  const randomDelay = (3 + Math.random() * 5) * 60000; // 3-8 minutes
  const t = setTimeout(() => {
    if (currentLogId !== logId) return;
    requestCapture(logId, "progress");
    scheduleRandom(logId, 0); // Chain next random capture
  }, afterMs + randomDelay);
  timers.push(t);
}

self.onmessage = function (e) {
  const { type, logId } = e.data;

  if (type === "start") {
    clearAllTimers();
    currentLogId = logId;

    // Immediate start screenshot
    requestCapture(logId, "start");

    // 1 minute progress
    const t1 = setTimeout(() => {
      requestCapture(logId, "progress");
    }, 60000);

    // 3 minute progress
    const t2 = setTimeout(() => {
      requestCapture(logId, "progress");
    }, 180000);

    timers = [t1, t2];

    // After 3 minutes, random 3-8 minute intervals
    scheduleRandom(logId, 180000);
  }

  if (type === "stop") {
    clearAllTimers();
    currentLogId = null;
  }
};
