/**
 * MinuteFlow Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * 1. Auto-capture screenshots on task start/end and at random intervals
 * 2. Queue screenshots locally and upload to Drive in batches (max 25/cycle, every 30s)
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
  VERSION: '1.1.0',

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
// Screenshot Capture
// ---------------------------------------------------------------------------

/**
 * Capture the visible area of the currently active tab.
 * Returns a Blob (PNG image).
 */
async function captureActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      console.warn('[MinuteFlow] No active tab found');
      return null;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://'))) {
      console.warn('[MinuteFlow] Cannot capture browser internal page');
      return null;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
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
// Screenshot Queue (local-first)
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot and add it to the local queue.
 * Used for all auto-scheduled captures (start, progress, end).
 * The retry loop will upload it to Drive within the next 30s.
 */
async function captureToQueue(screenshotType = 'progress', logId = null, captureRequestId = null) {
  const session = await DB.getSession();
  if (!session) {
    console.warn('[MinuteFlow] Not authenticated, skipping capture');
    return;
  }

  const resolvedLogId = logId || currentTaskLogId;
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

    const stored = await chrome.storage.local.get('mf_screenshot_queue');
    const queue = stored.mf_screenshot_queue || [];
    queue.push(item);
    await chrome.storage.local.set({ mf_screenshot_queue: queue });

    console.log(`[MinuteFlow] Queued ${screenshotType} screenshot (queue: ${queue.length})`);
  } catch (err) {
    console.error('[MinuteFlow] Failed to queue screenshot:', err.message);
  }
}

/**
 * Drain the upload queue: upload up to UPLOAD_BATCH_SIZE screenshots to Drive.
 * Called every 30 seconds by the minuteflow-upload-retry alarm.
 * Tracks consecutive failures and reports status to the server after each cycle.
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
  if (queue.length === 0) return; // Nothing to do

  // Reset daily counter if it's a new day
  const today = new Date().toISOString().slice(0, 10);
  let uploadedToday = stored.mf_upload_today_date === today
    ? (stored.mf_upload_today_count || 0)
    : 0;
  let consecutiveFailures = stored.mf_consecutive_failures || 0;
  let alertSent = stored.mf_alert_sent || false;

  // Take up to UPLOAD_BATCH_SIZE items from the front of the queue
  const batch = queue.slice(0, CONFIG.UPLOAD_BATCH_SIZE);
  const remaining = queue.slice(CONFIG.UPLOAD_BATCH_SIZE);

  let successCount = 0;
  const retryItems = []; // Items that failed — put back in queue

  for (const item of batch) {
    try {
      // Reconstitute blob from data URL
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
        successCount++;
        uploadedToday++;

        // If this was a remote capture, update its status
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
      } else {
        retryItems.push(item);
      }
    } catch (err) {
      console.error('[MinuteFlow] Upload failed for queued item:', err.message);
      retryItems.push(item);
    }
  }

  // Rebuild queue: failed items first, then anything beyond the batch
  const newQueue = [...retryItems, ...remaining];

  // Update consecutive failure counter
  if (batch.length > 0) {
    if (successCount > 0) {
      // At least one succeeded — streak is broken
      consecutiveFailures = 0;
      alertSent = false;
    } else {
      // Entire batch failed
      consecutiveFailures += 1;
    }
  }

  // Persist updated state
  await chrome.storage.local.set({
    mf_screenshot_queue: newQueue,
    mf_upload_today_date: today,
    mf_upload_today_count: uploadedToday,
    mf_consecutive_failures: consecutiveFailures,
    mf_alert_sent: alertSent,
  });

  console.log(
    `[MinuteFlow] Upload drain: ${successCount}/${batch.length} uploaded, ` +
    `${newQueue.length} remaining, ${consecutiveFailures} consecutive failures`
  );

  // Report status to server (for admin dashboard)
  await reportUploadStatus(session.user.id, newQueue.length, uploadedToday, consecutiveFailures);

  // Trigger admin alert exactly once per failure streak (at 3 failures)
  if (consecutiveFailures === 3 && !alertSent) {
    await chrome.storage.local.set({ mf_alert_sent: true });
    // reportUploadStatus already sends consecutiveFailures=3 to the server,
    // which triggers the email there. Nothing extra needed here.
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
    const resolvedLogId = logId || currentTaskLogId;
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
      await captureToQueue('progress', currentTaskLogId);
    }
    return;
  }

  if (alarm.name === 'minuteflow-3min') {
    console.log('[MinuteFlow] 3-minute capture triggered');
    if (currentTaskLogId) {
      await captureToQueue('progress', currentTaskLogId);
    }
    return;
  }

  if (alarm.name === 'minuteflow-checkin') {
    console.log('[MinuteFlow] Random check-in capture triggered');
    await captureToQueue('progress', currentTaskLogId);
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
  await captureToQueue('start', logId);

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
  await captureToQueue('end', logId || currentTaskLogId);

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
