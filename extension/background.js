/**
 * MinuteFlow Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * 1. Auto-capture screenshots on task start/end and at random intervals
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

  // Random check-in screenshot interval range (ms)
  CHECKIN_MIN_MS: 3 * 60 * 1000,
  CHECKIN_MAX_MS: 8 * 60 * 1000,

  // Extension version
  VERSION: '1.1.3',

  // API base
  API_BASE: 'https://minuteflow.click',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pollingIntervalId = null;
let heartbeatIntervalId = null;
let checkinTimeoutId = null;
let currentTaskLogId = null; // The active time_log.id we're tracking

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
      console.warn('[MinuteFlow] No browser window found');
      return null;
    }

    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab || !tab.id) {
      console.warn('[MinuteFlow] No active tab found');
      return null;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://'))) {
      console.warn('[MinuteFlow] Cannot capture browser internal page');
      return null;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
      format: 'png',
      quality: 90,
    });

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return blob;
  } catch (err) {
    console.error('[MinuteFlow] Capture failed:', err.message);
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
 * Remove a single item from the local queue by its ID.
 * Called after a confirmed successful upload to Drive.
 */
async function removeFromQueue(itemId) {
  const stored = await chrome.storage.local.get('mf_screenshot_queue');
  const queue = (stored.mf_screenshot_queue || []).filter(i => i.id !== itemId);
  await chrome.storage.local.set({ mf_screenshot_queue: queue });
}

/**
 * Upload a single queued item to Drive.
 * Returns true on success (caller should remove from queue).
 * Returns false on failure (caller should leave in queue for retry).
 */
async function uploadQueueItem(item) {
  try {
    const res = await fetch(item.dataUrl);
    const blob = await res.blob();

    const formData = new FormData();
    formData.append('file', blob, 'screenshot.png');
    formData.append('userId', item.userId);
    formData.append('logId', String(item.logId));
    formData.append('screenshotType', item.screenshotType);
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

  // For progress captures: skip if VA is currently on a MinuteFlow tab.
  // We only want to capture their actual work — not the time-tracking app itself.
  // Start/end captures are always allowed (once per task, Toni said that's fine).
  if (screenshotType === 'progress') {
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win && win.id) {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (activeTab && activeTab.url && isMinuteFlowUrl(activeTab.url)) {
          console.log('[MinuteFlow] Progress capture skipped — VA is on MinuteFlow tab');
          return;
        }
      }
    } catch (err) {
      // Non-fatal: if we can't check, proceed with capture
    }
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

  const blob = await captureActiveTab();
  if (!blob) return;

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
    };

    // Step 1: Save locally first — screenshot is safe regardless of what happens next
    const stored = await chrome.storage.local.get('mf_screenshot_queue');
    const queue = stored.mf_screenshot_queue || [];
    queue.push(item);
    await chrome.storage.local.set({ mf_screenshot_queue: queue });
    console.log(`[MinuteFlow] Saved locally: ${screenshotType} (queue: ${queue.length})`);

    // Step 2 + 3: Upload immediately → delete local on Drive confirmation
    await uploadQueueItem(item);
  } catch (err) {
    console.error('[MinuteFlow] Failed to capture/save screenshot:', err.message);
  }
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

  const blob = await captureActiveTab();
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
// Random Check-in Timer
// ---------------------------------------------------------------------------

function scheduleNextCheckin() {
  if (checkinTimeoutId) {
    clearTimeout(checkinTimeoutId);
    checkinTimeoutId = null;
  }

  const delay = CONFIG.CHECKIN_MIN_MS +
    Math.random() * (CONFIG.CHECKIN_MAX_MS - CONFIG.CHECKIN_MIN_MS);

  console.log(`[MinuteFlow] Next check-in in ${Math.round(delay / 1000)}s`);

  chrome.alarms.create('minuteflow-checkin', {
    delayInMinutes: delay / 60000,
  });
}

function cancelCheckin() {
  chrome.alarms.clear('minuteflow-checkin');
  chrome.alarms.clear('minuteflow-1min');
  chrome.alarms.clear('minuteflow-3min');
  if (checkinTimeoutId) {
    clearTimeout(checkinTimeoutId);
    checkinTimeoutId = null;
  }
}

// Handle all alarm fires in a single listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'minuteflow-1min') {
    console.log('[MinuteFlow] 1-minute capture triggered');
    if (currentTaskLogId) {
      await captureLocalThenUpload('progress', currentTaskLogId);
    }
    return;
  }

  if (alarm.name === 'minuteflow-3min') {
    console.log('[MinuteFlow] 3-minute capture triggered');
    if (currentTaskLogId) {
      await captureLocalThenUpload('progress', currentTaskLogId);
    }
    return;
  }

  if (alarm.name === 'minuteflow-checkin') {
    console.log('[MinuteFlow] Random check-in capture triggered');
    await captureLocalThenUpload('progress', currentTaskLogId);
    if (currentTaskLogId) {
      scheduleNextCheckin();
    }
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

  // 1 and 3 minute follow-up screenshots
  chrome.alarms.create('minuteflow-1min', { delayInMinutes: 1 });
  chrome.alarms.create('minuteflow-3min', { delayInMinutes: 3 });

  // First random check-in between 5-8 minutes from task start
  const firstRandomDelay = (5 + Math.random() * 3) * 60 * 1000;
  chrome.alarms.create('minuteflow-checkin', { delayInMinutes: firstRandomDelay / 60000 });
}

async function onTaskEnd(logId) {
  console.log(`[MinuteFlow] Task ended: log_id=${logId || currentTaskLogId}`);

  // End screenshot → goes to queue
  await captureLocalThenUpload('end', logId || currentTaskLogId);

  cancelCheckin();
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
  cancelCheckin();
}

// ---------------------------------------------------------------------------
// Session Monitoring
// ---------------------------------------------------------------------------

let lastActiveTaskId = null;

async function checkSessionState() {
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

    if (activeTask && parsedLogId) {
      if (parsedLogId !== lastActiveTaskId) {
        if (lastActiveTaskId) {
          await onTaskEnd(lastActiveTaskId);
        }
        lastActiveTaskId = parsedLogId;
        await onTaskStart(parsedLogId);
      }
    } else {
      if (lastActiveTaskId) {
        await onTaskEnd(lastActiveTaskId);
        lastActiveTaskId = null;
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
      scheduleNextCheckin();
    }
  } else {
    console.log('[MinuteFlow] Not authenticated — waiting for login');
  }
}

initialize();

// Keep service worker alive
chrome.alarms.create('minuteflow-keepalive', { periodInMinutes: 0.5 });
