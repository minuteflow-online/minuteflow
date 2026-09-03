/**
 * MinuteFlow Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * 1. Auto-capture screenshots on task start/end and every 5 minutes in between,
 *    recording a labelled marker instead when the machine is idle or locked
 * 2. Local-first upload: save locally → upload to Drive immediately → delete local on success
 *    (retry alarm picks up any items that failed the immediate upload)
 * 3. Poll for remote capture requests from admin
 * 4. Poll for new messages and relay to content script as toast notifications
 * 5. Send heartbeat to server so admin knows extension is active
 * 6. Report upload queue status to server; alert admins after 3 consecutive failed cycles
 */

importScripts('supabase.js');

const DB = globalThis.MinuteFlowDB;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  // Polling interval for capture requests and messages (ms)
  POLL_INTERVAL_MS: 5000,

  // Heartbeat interval (ms) — tells server the extension is alive
  HEARTBEAT_INTERVAL_MS: 30000,

  // Upload retry interval — how often we drain the screenshot queue (every 30s)
  UPLOAD_RETRY_ALARM: 'minuteflow-upload-retry',
  UPLOAD_RETRY_MINUTES: 0.5, // 30 seconds

  // Max screenshots to upload per retry cycle (prevents Drive flooding)
  UPLOAD_BATCH_SIZE: 25,

  // Screenshot cadence: one capture every 5 minutes for the whole time a VA is
  // clocked in — not just while a task happens to be open.
  // This is the ONLY capture schedule — the app's in-page worker stands down
  // whenever the extension is installed, so a VA is never captured twice.
  CAPTURE_INTERVAL_MINUTES: 5,

  // No keyboard or mouse input for this long means the machine is idle. Matched
  // to the capture interval so an "idle" marker means idle for the whole slot,
  // not merely idle at the instant the alarm happened to fire.
  IDLE_THRESHOLD_SECONDS: 300,

  // The app captures the whole monitor when a VA is sharing their screen, which
  // is the only way to see work outside Chrome. This extension only sees a
  // browser tab, so it defers: it fires 90 seconds after the app would have,
  // and skips its own capture if the slot is already covered.
  CAPTURE_OFFSET_MINUTES: 1.5,
  SLOT_COVERED_MINUTES: 4,

  // Extension version
  // Read, never restated. This was hardcoded and the 1.2.2 release bumped
  // manifest.json without it, so every install on earth reported 1.2.1 —
  // including the ones that had updated — and the server nagged all of them
  // to install a version they already had.
  VERSION: chrome.runtime.getManifest().version,

  // API base
  API_BASE: 'https://minuteflow.click',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pollingIntervalId = null;
let heartbeatIntervalId = null;
let currentTaskLogId = null; // The active time_log.id we're tracking
let isClockedIn = false;     // Capture runs for the whole shift, not just while a task is open

// ---------------------------------------------------------------------------
// MinuteFlow URL Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given URL belongs to the MinuteFlow app.
 * Progress captures are skipped when the VA is on MinuteFlow — we only
 * want to capture their actual work, not the time-tracking app itself.
 * (Start/end captures are still allowed regardless of active tab.)
 */
function isMinuteFlowUrl(url) {
  if (!url) return false;
  return url.includes('minuteflow.click') || url.includes('minuteflow.online');
}

// ---------------------------------------------------------------------------
// Screenshot Capture
// ---------------------------------------------------------------------------

/**
 * Capture the visible area of the currently active tab.
 * Returns a Blob (PNG image).
 *
 * Uses lastFocusedWindow (normal window type) so that if the extension popup
 * is open, we still capture the underlying browser tab — not the popup window.
 */
async function captureActiveTab() {
  try {
    // Get the last focused normal browser window (excludes extension popups)
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!win || !win.id) {
      return { blob: null, reason: 'Chrome was not open' };
    }

    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab || !tab.id) {
      return { blob: null, reason: 'No tab open in Chrome' };
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://'))) {
      return { blob: null, reason: 'On a browser settings page' };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
      format: 'png',
      quality: 90,
    });

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return { blob, reason: null };
  } catch (err) {
    // captureVisibleTab refuses when the window is not the one on screen, which
    // is the common case by far: the VA is working in another application, or
    // Chrome is minimised. Saying so beats a generic failure, because "not at
    // the machine" and "working somewhere else" mean very different things when
    // someone reviews the day.
    console.warn('[MinuteFlow] Capture failed:', err.message);
    return { blob: null, reason: 'Chrome was minimised or another app was in front' };
  }
}

/**
 * Perceptual fingerprint of a capture — a 64-bit difference hash as 16 hex chars.
 *
 * The image is squashed to 9x8 greyscale and each pixel compared to its right-hand
 * neighbour, so the hash describes the *layout* of the screen rather than its exact
 * pixels. Two captures of a screen nobody touched come out identical even though a
 * blinking cursor or a ticking clock makes their PNG bytes differ — a byte-for-byte
 * hash would call those two frames different and catch almost nothing.
 *
 * Returns null if the image can't be read; callers treat that as "unknown", never
 * as "changed", so a fingerprint failure can never mark someone idle.
 */
async function imageFingerprint(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const width = 9;
    const height = 8;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const { data } = ctx.getImageData(0, 0, width, height);
    const grey = [];
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      grey.push(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    }

    let bits = '';
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        bits += grey[y * width + x] > grey[y * width + x + 1] ? '1' : '0';
      }
    }

    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (err) {
    console.warn('[MinuteFlow] Fingerprint failed:', err.message);
    return null;
  }
}

/**
 * Fetch the active log ID from the sessions table.
 * Used as a fallback when currentTaskLogId is null (e.g. after service worker restart).
 */
async function fetchActiveLogIdFromDB(userId) {
  try {
    const rows = await DB.query('sessions', {
      filters: `user_id=eq.${userId}&select=active_task&limit=1`,
    });
    if (!rows || rows.length === 0) return null;
    const activeTask = rows[0].active_task;
    if (!activeTask) return null;
    const logId = activeTask.logId || activeTask.log_id;
    return logId ? (parseInt(logId, 10) || logId) : null;
  } catch (err) {
    console.warn('[MinuteFlow] fetchActiveLogIdFromDB failed:', err.message);
    return null;
  }
}

/**
 * True while the person is on a break or on personal time.
 *
 * Breaks are stored on sessions.active_task as isBreak; Personal is a task
 * category. Both mean the same thing here — time the person is not working and
 * their screen is their own.
 *
 * Returns false when the answer cannot be fetched. A network blip must not
 * quietly stop captures for a whole shift; a missed pause is recoverable, a
 * silently empty day of tracking is not.
 */
async function isOnBreak(userId) {
  try {
    const rows = await DB.query('sessions', {
      filters: `user_id=eq.${userId}&select=active_task&limit=1`,
    });
    const activeTask = rows && rows[0] ? rows[0].active_task : null;
    if (!activeTask) return false;
    return Boolean(activeTask.isBreak) || activeTask.category === 'Personal';
  } catch (err) {
    console.warn('[MinuteFlow] isOnBreak check failed:', err.message);
    return false;
  }
}

/**
 * Convert a Blob to a base64 data URL for storage in chrome.storage.local.
 * Uses chunked encoding to handle large files safely in a service worker.
 */
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return 'data:image/png;base64,' + btoa(binary);
}

// ---------------------------------------------------------------------------
// Screenshot Queue (local-first, immediate upload)
// ---------------------------------------------------------------------------

/**
 * IDs currently being uploaded. An item stays in the queue until Drive confirms,
 * so without this the 30-second retry drain happily picks up an item whose first
 * upload is still in flight and sends it a second time — every extra send creating
 * another row and another Drive file for one screenshot. That, draining at 25
 * items per 30 seconds, is what produced ~50 rows a minute.
 */
const inFlightUploads = new Set();

/**
 * Serialises every read-modify-write of the queue. Two writers resolving together
 * would each store a snapshot taken before the other, resurrecting an item that had
 * already been uploaded and removed.
 */
let queueWriteLock = Promise.resolve();

function withQueueLock(fn) {
  const run = queueWriteLock.then(fn, fn);
  queueWriteLock = run.catch(() => {});
  return run;
}

/**
 * Move a failed item to the end of the queue and count the attempt, so the next
 * drain works on different items. Nothing is discarded: a screenshot that cannot
 * upload yet (offline, server down) still gets its turn on a later cycle.
 */
async function rotateToBackOfQueue(itemId) {
  return withQueueLock(async () => {
    const stored = await chrome.storage.local.get('mf_screenshot_queue');
    const queue = stored.mf_screenshot_queue || [];
    const at = queue.findIndex(i => i.id === itemId);
    if (at === -1) return;
    const [item] = queue.splice(at, 1);
    item.attempts = (item.attempts || 0) + 1;
    queue.push(item);
    await chrome.storage.local.set({ mf_screenshot_queue: queue });
  });
}

/**
 * Remove a single item from the local queue by its ID.
 * Called after a confirmed successful upload to Drive.
 */
async function removeFromQueue(itemId) {
  return withQueueLock(async () => {
    const stored = await chrome.storage.local.get('mf_screenshot_queue');
    const queue = (stored.mf_screenshot_queue || []).filter(i => i.id !== itemId);
    await chrome.storage.local.set({ mf_screenshot_queue: queue });
  });
}

/**
 * Upload a single queued item to Drive.
 * Returns true on success (caller should remove from queue).
 * Returns false on failure (caller should leave in queue for retry).
 */
async function uploadQueueItem(item) {
  if (inFlightUploads.has(item.id)) {
    console.log(`[MinuteFlow] Upload already in flight, skipping: ${item.id}`);
    return false;
  }
  inFlightUploads.add(item.id);

  try {
    // Markers carry no image — they record *why* a slot has no screenshot
    // (idle, locked, on MinuteFlow). They ride the same queue as real uploads
    // so a marker recorded while offline still lands once the connection
    // comes back, but they go through the server (service role), not a direct
    // table write: task_screenshots has no anon/authenticated grants — every
    // write to it goes through a route like this one, and a direct insert
    // with the VA's own token was failing with 42501 on every single retry.
    if (item.kind === 'marker') {
      const res = await fetch(`${CONFIG.API_BASE}/api/screenshot-marker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: item.userId,
          logId: item.logId,
          failureReason: item.failureReason,
          capturedAt: item.timestamp,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `Marker insert failed: ${res.status}`);
      }
      await removeFromQueue(item.id);
      console.log(`[MinuteFlow] Marker recorded: ${item.failureReason}`);
      return true;
    }

    const res = await fetch(item.dataUrl);
    const blob = await res.blob();

    const formData = new FormData();
    formData.append('file', blob, 'screenshot.png');
    formData.append('userId', item.userId);
    formData.append('logId', String(item.logId));
    formData.append('screenshotType', item.screenshotType);
    // When the shot was taken, not when it reached the server. Uploads can sit
    // in this queue for hours, so without this the server's own clock is the
    // only timestamp and a drained backlog looks like a burst of activity.
    formData.append('capturedAt', item.timestamp);
    if (item.fingerprint) {
      formData.append('fingerprint', item.fingerprint);
    }
    if (item.captureRequestId) {
      formData.append('captureRequestId', String(item.captureRequestId));
    }

    const uploadRes = await fetch(`${CONFIG.API_BASE}/api/upload-screenshot`, {
      method: 'POST',
      body: formData,
    });

    if (uploadRes.ok) {
      // Step 3: Drive confirmed — safe to delete local copy
      await removeFromQueue(item.id);
      console.log(`[MinuteFlow] Drive confirmed → local deleted: ${item.screenshotType} (${item.id})`);

      if (item.captureRequestId) {
        const data = await uploadRes.json();
        await DB.query('capture_requests', {
          method: 'PATCH',
          filters: `id=eq.${item.captureRequestId}`,
          body: {
            status: 'captured',
            screenshot_id: data.screenshot?.id || null,
            completed_at: new Date().toISOString(),
          },
        });
      }
      return true;
    } else {
      console.warn(`[MinuteFlow] Upload failed, keeping local copy for retry: ${item.screenshotType}`);
      return false;
    }
  } catch (err) {
    console.error('[MinuteFlow] Upload error, keeping local copy for retry:', err.message);
    return false;
  } finally {
    inFlightUploads.delete(item.id);
  }
}

/**
 * Capture a screenshot using the 3-step local-first flow:
 * 1. Save to chrome.storage.local immediately
 * 2. Upload to Google Drive right away
 * 3. Drive confirms → delete local copy
 *
 * If the upload fails, the item stays in local storage and the retry
 * alarm (drainUploadQueue) will pick it up within 30 seconds.
 */
async function captureLocalThenUpload(screenshotType = 'progress', logId = null, captureRequestId = null) {
  const session = await DB.getSession();
  if (!session) {
    console.warn('[MinuteFlow] Not authenticated, skipping capture');
    return;
  }

  // Prefer explicit logId, then in-memory, then DB fallback
  let resolvedLogId = logId || currentTaskLogId;
  if (!resolvedLogId) {
    resolvedLogId = await fetchActiveLogIdFromDB(session.user.id);
  }
  if (!resolvedLogId) {
    console.warn('[MinuteFlow] No active log ID, skipping capture');
    return;
  }

  // For progress captures, a slot that produces no screenshot records *why*
  // instead of vanishing. A silent gap is indistinguishable from the extension
  // having died, which is the thing that made these timelines untrustworthy.
  if (screenshotType === 'progress') {
    const idleState = await idleReason();
    if (idleState) {
      await queueMarker(session.user.id, resolvedLogId, idleState);
      return;
    }

    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win && win.id) {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (activeTab && activeTab.url && isMinuteFlowUrl(activeTab.url)) {
          console.log('[MinuteFlow] Progress capture skipped — VA is on MinuteFlow tab');
          await queueMarker(session.user.id, resolvedLogId, 'On MinuteFlow — not captured');
          return;
        }
      }
    } catch (err) {
      // Non-fatal: if we can't check, proceed with capture
    }
  }

  const { blob, reason: captureFailure } = await captureActiveTab();
  if (!blob) {
    if (screenshotType === 'progress') {
      await queueMarker(
        session.user.id,
        resolvedLogId,
        captureFailure || 'Screen could not be captured'
      );
    }
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dataUrl,
      logId: resolvedLogId,
      screenshotType,
      captureRequestId: captureRequestId || null,
      userId: session.user.id,
      timestamp: new Date().toISOString(),
      fingerprint: await imageFingerprint(blob),
    };

    // Step 1: Save locally first — screenshot is safe regardless of what happens next
    await withQueueLock(async () => {
      const stored = await chrome.storage.local.get('mf_screenshot_queue');
      const queue = stored.mf_screenshot_queue || [];
      queue.push(item);
      await chrome.storage.local.set({ mf_screenshot_queue: queue });
      console.log(`[MinuteFlow] Saved locally: ${screenshotType} (queue: ${queue.length})`);
    });

    // Step 2 + 3: Upload immediately → delete local on Drive confirmation
    await uploadQueueItem(item);
  } catch (err) {
    console.error('[MinuteFlow] Failed to capture/save screenshot:', err.message);
  }
}

/**
 * Why this machine can't produce a meaningful screenshot right now, or null if
 * it can. Reads OS-level input state, so "idle" means no keyboard or mouse for
 * IDLE_THRESHOLD_SECONDS — not merely a still-looking screen.
 *
 * Any failure returns null (capture proceeds): a broken idle check must never
 * be able to mark a working VA as idle.
 */
/**
 * True when a screenshot already exists for this task within the current slot —
 * meaning the app captured the monitor and there is nothing for a browser-only
 * capture to add. Any failure answers false, so a lookup problem costs a
 * duplicate rather than a missing screenshot.
 */
async function slotAlreadyCovered(logId) {
  try {
    const since = new Date(Date.now() - CONFIG.SLOT_COVERED_MINUTES * 60000).toISOString();
    const rows = await DB.query('task_screenshots', {
      filters:
        `log_id=eq.${logId}&captured_at=gte.${since}&screenshot_type=neq.failed&select=id&limit=1`,
    });
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('[MinuteFlow] Slot check failed, capturing anyway:', err.message);
    return false;
  }
}

async function idleReason() {
  try {
    const state = await chrome.idle.queryState(CONFIG.IDLE_THRESHOLD_SECONDS);
    if (state === 'locked') return 'Screen locked';
    if (state === 'idle') return 'Computer idle';
    return null;
  } catch (err) {
    console.warn('[MinuteFlow] Idle check failed, capturing anyway:', err.message);
    return null;
  }
}

/**
 * Record a slot that produced no screenshot, with the reason. Goes through the
 * upload queue so it survives being offline — which is itself one of the reasons
 * a slot can come up empty.
 */
async function queueMarker(userId, logId, failureReason) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'marker',
    userId,
    logId,
    failureReason,
    timestamp: new Date().toISOString(),
  };

  await withQueueLock(async () => {
    const stored = await chrome.storage.local.get('mf_screenshot_queue');
    const queue = stored.mf_screenshot_queue || [];
    queue.push(item);
    await chrome.storage.local.set({ mf_screenshot_queue: queue });
  });
  console.log(`[MinuteFlow] Slot marked: ${failureReason}`);

  await uploadQueueItem(item);
}

/**
 * Retry alarm handler: attempt to upload any screenshots still in local storage.
 * Under normal operation the queue should be empty — items are uploaded immediately
 * by captureLocalThenUpload and removed from local storage on Drive confirmation.
 * This only runs every 30s to catch items whose immediate upload failed (network hiccup, etc).
 */
async function drainUploadQueue() {
  const session = await DB.getSession();
  if (!session) return;

  const stored = await chrome.storage.local.get([
    'mf_screenshot_queue',
    'mf_upload_today_date',
    'mf_upload_today_count',
    'mf_consecutive_failures',
    'mf_alert_sent',
  ]);

  const queue = stored.mf_screenshot_queue || [];
  if (queue.length === 0) return; // Nothing to retry

  console.log(`[MinuteFlow] Retry drain: ${queue.length} item(s) waiting`);

  const today = new Date().toISOString().slice(0, 10);
  let uploadedToday = stored.mf_upload_today_date === today
    ? (stored.mf_upload_today_count || 0)
    : 0;
  let consecutiveFailures = stored.mf_consecutive_failures || 0;
  let alertSent = stored.mf_alert_sent || false;

  // Retry up to UPLOAD_BATCH_SIZE items
  const batch = queue.slice(0, CONFIG.UPLOAD_BATCH_SIZE);
  let successCount = 0;

  for (const item of batch) {
    const ok = await uploadQueueItem(item); // removes from queue internally on success
    if (ok) {
      successCount++;
      uploadedToday++;
    } else {
      // A failure sends the item to the BACK of the queue rather than leaving it
      // at the front. An item that can never succeed — a screenshot whose time log
      // was deleted, say — otherwise occupies a batch slot on every cycle and
      // blocks everything behind it indefinitely. That is what stalled uploads for
      // hours: a handful of dead items at the head, and a queue that never moved.
      await rotateToBackOfQueue(item.id);
    }
  }

  // Re-read queue after uploadQueueItem calls (it modifies storage directly)
  const afterStored = await chrome.storage.local.get('mf_screenshot_queue');
  const newQueue = afterStored.mf_screenshot_queue || [];

  // Update consecutive failure counter
  if (batch.length > 0) {
    if (successCount > 0) {
      consecutiveFailures = 0;
      alertSent = false;
    } else {
      consecutiveFailures += 1;
    }
  }

  await chrome.storage.local.set({
    mf_upload_today_date: today,
    mf_upload_today_count: uploadedToday,
    mf_consecutive_failures: consecutiveFailures,
    mf_alert_sent: alertSent,
  });

  console.log(
    `[MinuteFlow] Retry drain: ${successCount}/${batch.length} retried successfully, ` +
    `${newQueue.length} still waiting, ${consecutiveFailures} consecutive failures`
  );

  await reportUploadStatus(session.user.id, newQueue.length, uploadedToday, consecutiveFailures);

  if (consecutiveFailures === 3 && !alertSent) {
    await chrome.storage.local.set({ mf_alert_sent: true });
  }
}

/**
 * Report upload queue status to the server.
 * The server saves this to extension_upload_status and emails admins if needed.
 */
async function reportUploadStatus(userId, queued, uploadedToday, consecutiveFailures) {
  try {
    await fetch(`${CONFIG.API_BASE}/api/extension-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, queued, uploadedToday, consecutiveFailures, version: CONFIG.VERSION }),
    });
  } catch (err) {
    console.error('[MinuteFlow] Status report failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Direct Upload (for remote/manual captures — admin is waiting)
// ---------------------------------------------------------------------------

/**
 * Capture screenshot and upload directly to Drive (no queue).
 * Used for remote capture requests (admin waiting) and manual captures (popup waiting).
 */
async function captureAndUpload(screenshotType = 'manual', logId = null, captureRequestId = null) {
  const session = await DB.getSession();
  if (!session) {
    console.warn('[MinuteFlow] Not authenticated, skipping capture');
    return null;
  }

  const { blob } = await captureActiveTab();
  if (!blob) return null;

  try {
    // Prefer explicit logId, then in-memory currentTaskLogId, then DB fallback
    // (service worker restarts clear currentTaskLogId — DB always has the truth)
    let resolvedLogId = logId || currentTaskLogId;
    if (!resolvedLogId) {
      resolvedLogId = await fetchActiveLogIdFromDB(session.user.id);
    }
    if (!resolvedLogId) {
      console.warn('[MinuteFlow] No active log ID, skipping upload');
      return null;
    }

    const formData = new FormData();
    formData.append('file', blob, 'screenshot.png');
    formData.append('userId', session.user.id);
    formData.append('logId', String(resolvedLogId));
    formData.append('screenshotType', screenshotType);
    if (captureRequestId) formData.append('captureRequestId', String(captureRequestId));

    const res = await fetch(`${CONFIG.API_BASE}/api/upload-screenshot`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[MinuteFlow] Direct upload failed:', errText);
      return null;
    }

    const data = await res.json();
    const screenshot = data.screenshot;
    console.log('[MinuteFlow] Screenshot -> Drive (direct):', screenshotType, screenshot?.drive_file_id);
    return screenshot || null;
  } catch (err) {
    console.error('[MinuteFlow] Direct upload failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Capture Schedule
// ---------------------------------------------------------------------------

/**
 * One scheduled slot. Every 5 minutes while the VA is clocked in, this produces
 * exactly one row: a screenshot, or a marker saying why there isn't one.
 *
 * The 'no active task' case matters most. The schedule used to be cancelled the
 * moment a task ended, so a VA who was clocked in but between tasks generated
 * nothing at all — no screenshot, no marker, no way to tell that apart from the
 * extension having crashed. That silence is the thing this exists to remove.
 */
async function runScheduledCapture() {
  if (!isClockedIn) return; // Off the clock — nothing to account for.

  const session = await DB.getSession();
  if (!session) return;

  // A break is time away from work, and photographing someone's screen through
  // it is not something a time tracker should do. Checked against the server
  // rather than in-memory state, because the service worker restarts freely and
  // a lost flag would silently resume capturing mid-break.
  if (await isOnBreak(session.user.id)) return;

  if (currentTaskLogId) {
    if (await slotAlreadyCovered(currentTaskLogId)) {
      console.log('[MinuteFlow] Slot already captured by the app — skipping.');
      return;
    }
    await captureLocalThenUpload('progress', currentTaskLogId);
    return;
  }

  // The service worker restarts freely, so an in-memory null may just be lost
  // state rather than a genuinely absent task. Ask the server before concluding.
  const resolved = await fetchActiveLogIdFromDB(session.user.id);
  if (resolved) {
    currentTaskLogId = resolved;
    await captureLocalThenUpload('progress', resolved);
    return;
  }

  await queueMarker(session.user.id, null, 'Clocked in — no active task');
}

/** Start (or restart) the 5-minute capture alarm for the running task. */
function startCaptureSchedule() {
  chrome.alarms.create('minuteflow-capture', {
    periodInMinutes: CONFIG.CAPTURE_INTERVAL_MINUTES,
    delayInMinutes: CONFIG.CAPTURE_INTERVAL_MINUTES + CONFIG.CAPTURE_OFFSET_MINUTES,
  });
}

/**
 * Stop capturing. Also clears the pre-1.2.0 alarm names: chrome.alarms survive
 * an extension update, so without this an upgrading VA would keep firing the old
 * 1-minute and 3-minute alarms alongside the new schedule.
 */
function cancelCaptureSchedule() {
  chrome.alarms.clear('minuteflow-capture');
  chrome.alarms.clear('minuteflow-checkin');
  chrome.alarms.clear('minuteflow-1min');
  chrome.alarms.clear('minuteflow-3min');
}

// Handle all alarm fires in a single listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'minuteflow-capture') {
    await runScheduledCapture();
    return;
  }

  if (alarm.name === CONFIG.UPLOAD_RETRY_ALARM) {
    await drainUploadQueue();
    return;
  }

  if (alarm.name === 'minuteflow-keepalive') {
    const session = await DB.ensureAuth();
    if (session && !pollingIntervalId) {
      console.log('[MinuteFlow] Service worker revived — restarting polling');
      startPolling();
    }
  }
});

// ---------------------------------------------------------------------------
// Task Lifecycle
// ---------------------------------------------------------------------------

async function onTaskStart(logId) {
  currentTaskLogId = logId;
  await chrome.storage.local.set({ mf_active_log_id: logId });

  console.log(`[MinuteFlow] Task started: log_id=${logId}`);

  // Immediate start screenshot → goes to queue
  await captureLocalThenUpload('start', logId);

  // One repeating capture every 5 minutes for the life of the task. Replaces the
  // old 1-minute, 3-minute and random 3-8 minute alarms, which stacked on top of
  // the app's own in-page schedule and produced several times the intended volume.
  chrome.alarms.create('minuteflow-capture', {
    periodInMinutes: CONFIG.CAPTURE_INTERVAL_MINUTES,
    delayInMinutes: CONFIG.CAPTURE_INTERVAL_MINUTES + CONFIG.CAPTURE_OFFSET_MINUTES,
  });
}

async function onTaskEnd(logId) {
  console.log(`[MinuteFlow] Task ended: log_id=${logId || currentTaskLogId}`);

  // End screenshot → goes to queue
  await captureLocalThenUpload('end', logId || currentTaskLogId);

  // Deliberately does NOT cancel the capture schedule. The VA is still on the
  // clock between tasks, and stopping here is what produced hour-long stretches
  // with no screenshots and no explanation. Clock-out cancels it instead.
  currentTaskLogId = null;
  await chrome.storage.local.remove('mf_active_log_id');
}

// ---------------------------------------------------------------------------
// Polling: Remote Capture Requests + Messages
// ---------------------------------------------------------------------------

async function pollCaptureRequests() {
  const session = await DB.getSession();
  if (!session) return;

  try {
    const requests = await DB.query('capture_requests', {
      filters: `target_user_id=eq.${session.user.id}&status=eq.pending&order=created_at.asc`,
    });

    if (!requests || requests.length === 0) return;

    for (const req of requests) {
      console.log(`[MinuteFlow] Remote capture request: ${req.id}`);

      // Direct upload for remote captures — admin is waiting for immediate result
      const screenshot = await captureAndUpload('remote', req.log_id, req.id);

      await DB.query('capture_requests', {
        method: 'PATCH',
        filters: `id=eq.${req.id}`,
        body: {
          status: screenshot ? 'captured' : 'failed',
          screenshot_id: screenshot?.id || null,
          completed_at: new Date().toISOString(),
        },
      });
    }
  } catch (err) {
    console.error('[MinuteFlow] Poll capture requests failed:', err.message);
  }
}

async function pollMessages() {
  const session = await DB.getSession();
  if (!session) return;

  try {
    const messages = await DB.query('messages', {
      filters: `target_user_id=eq.${session.user.id}&read=eq.false&order=created_at.asc`,
    });

    if (!messages || messages.length === 0) return;

    for (const msg of messages) {
      await showToast(msg.content, msg.sender_id);

      await DB.query('messages', {
        method: 'PATCH',
        filters: `id=eq.${msg.id}`,
        body: { read: true },
      });
    }
  } catch (err) {
    console.error('[MinuteFlow] Poll messages failed:', err.message);
  }
}

async function showToast(message, senderId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'MinuteFlow',
        message: message,
      });
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      type: 'MINUTEFLOW_TOAST',
      message,
      senderId,
    });
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'MinuteFlow',
      message: message,
    });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

async function sendHeartbeat() {
  const session = await DB.getSession();
  if (!session) return;

  try {
    await DB.query('extension_heartbeats', {
      method: 'POST',
      filters: 'on_conflict=user_id',
      body: {
        user_id: session.user.id,
        extension_version: CONFIG.VERSION,
        last_seen: new Date().toISOString(),
        is_active: true,
      },
      headers: {
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
    });
  } catch (err) {
    console.error('[MinuteFlow] Heartbeat failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Polling Lifecycle
// ---------------------------------------------------------------------------

function startPolling() {
  if (pollingIntervalId) return;

  console.log('[MinuteFlow] Starting poll cycle');

  // Immediate first run
  checkSessionState();
  pollCaptureRequests();
  pollMessages();
  sendHeartbeat();

  pollingIntervalId = setInterval(() => {
    checkSessionState();
    pollCaptureRequests();
    pollMessages();
  }, CONFIG.POLL_INTERVAL_MS);

  heartbeatIntervalId = setInterval(() => {
    sendHeartbeat();
  }, CONFIG.HEARTBEAT_INTERVAL_MS);

  // Upload retry alarm — drains the screenshot queue every 30s
  chrome.alarms.create(CONFIG.UPLOAD_RETRY_ALARM, {
    periodInMinutes: CONFIG.UPLOAD_RETRY_MINUTES,
  });
}

function stopPolling() {
  console.log('[MinuteFlow] Stopping poll cycle');

  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }

  chrome.alarms.clear(CONFIG.UPLOAD_RETRY_ALARM);
  cancelCaptureSchedule();
}

// ---------------------------------------------------------------------------
// Session Monitoring
// ---------------------------------------------------------------------------

let lastActiveTaskId = null;

// Guards against overlapping runs: the 5s poll can fire again while a previous
// run is still awaiting a capture, and two runs both driving a task transition
// is how a single task switch produced three screenshots.
let sessionCheckInFlight = false;

async function checkSessionState() {
  if (sessionCheckInFlight) return;
  sessionCheckInFlight = true;
  try {
    await runSessionCheck();
  } finally {
    sessionCheckInFlight = false;
  }
}

async function runSessionCheck() {
  const session = await DB.getSession();
  if (!session) return;

  try {
    const rows = await DB.query('sessions', {
      filters: `user_id=eq.${session.user.id}&limit=1`,
    });

    if (!rows || rows.length === 0) return;

    const userSession = rows[0];
    const activeTask = userSession.active_task;
    const taskLogId = activeTask ? (activeTask.logId || activeTask.log_id) : null;
    const parsedLogId = taskLogId ? parseInt(taskLogId, 10) || taskLogId : null;

    // Capture spans the whole shift, so the schedule is driven by clocked-in
    // state rather than by task transitions. A VA who has clocked in but not
    // opened a task yet is still accounted for, and ending a task no longer
    // leaves an unexplained silence until the next one starts.
    const wasClockedIn = isClockedIn;
    isClockedIn = !!userSession.clocked_in;
    if (isClockedIn && !wasClockedIn) startCaptureSchedule();
    if (!isClockedIn && wasClockedIn) cancelCaptureSchedule();

    // lastActiveTaskId is claimed BEFORE awaiting the handlers, not after. Both
    // onTaskEnd and onTaskStart capture and upload a screenshot, which takes
    // seconds — and this poll runs every 5s. Assigning afterwards left the stale
    // value visible to the next poll, which re-ran the same transition; that is
    // where the duplicate start/end pairs 4-5 seconds apart came from.
    if (activeTask && parsedLogId) {
      if (parsedLogId !== lastActiveTaskId) {
        const previous = lastActiveTaskId;
        lastActiveTaskId = parsedLogId;
        if (previous) {
          await onTaskEnd(previous);
        }
        await onTaskStart(parsedLogId);
      }
    } else {
      if (lastActiveTaskId) {
        const previous = lastActiveTaskId;
        lastActiveTaskId = null;
        await onTaskEnd(previous);
      }
    }
  } catch (err) {
    console.error('[MinuteFlow] Session check failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Message Handlers (from popup and content scripts)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MINUTEFLOW_LOGIN') {
    DB.signIn(msg.email, msg.password)
      .then((data) => {
        startPolling();
        sendResponse({ success: true, user: data.user });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'MINUTEFLOW_LOGOUT') {
    stopPolling();
    DB.signOut()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.type === 'MINUTEFLOW_GET_STATUS') {
    DB.getSession()
      .then(async (session) => {
        if (!session) {
          sendResponse({ loggedIn: false });
          return;
        }

        let profile = null;
        try {
          const profiles = await DB.query('profiles', {
            filters: `id=eq.${session.user.id}`,
          });
          profile = profiles?.[0] || null;
        } catch (_) {}

        // Include queue size so popup can show it
        const stored = await chrome.storage.local.get([
          'mf_screenshot_queue',
          'mf_upload_today_count',
          'mf_upload_today_date',
        ]);
        const today = new Date().toISOString().slice(0, 10);
        const queueSize = (stored.mf_screenshot_queue || []).length;
        const uploadedToday = stored.mf_upload_today_date === today
          ? (stored.mf_upload_today_count || 0)
          : 0;

        sendResponse({
          loggedIn: true,
          user: session.user,
          profile,
          activeLogId: currentTaskLogId,
          polling: !!pollingIntervalId,
          queueSize,
          uploadedToday,
        });
      });
    return true;
  }

  if (msg.type === 'MINUTEFLOW_MANUAL_CAPTURE') {
    // Direct upload for manual captures — user expects immediate feedback
    captureAndUpload('manual', msg.logId || currentTaskLogId)
      .then((screenshot) => {
        sendResponse({ success: !!screenshot, screenshot });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'MINUTEFLOW_TASK_START') {
    onTaskStart(msg.logId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.type === 'MINUTEFLOW_TASK_END') {
    onTaskEnd(msg.logId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function initialize() {
  console.log('[MinuteFlow] Extension initializing (v' + CONFIG.VERSION + ')...');

  // Restore active log ID from previous session
  const stored = await chrome.storage.local.get(['mf_active_log_id']);
  if (stored.mf_active_log_id) {
    currentTaskLogId = stored.mf_active_log_id;
    console.log(`[MinuteFlow] Restored active log: ${currentTaskLogId}`);
  }

  const session = await DB.ensureAuth();
  if (session) {
    console.log(`[MinuteFlow] Authenticated as ${session.user.email}`);
    startPolling();

    if (currentTaskLogId) {
      startCaptureSchedule();
    }
  } else {
    console.log('[MinuteFlow] Not authenticated — waiting for login');
  }
}

initialize();

// Keep service worker alive
chrome.alarms.create('minuteflow-keepalive', { periodInMinutes: 0.5 });
