/**
 * MinuteFlow Chrome Extension — Popup Script
 */

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');
const statusBadge = document.getElementById('status-badge');
const noTask = document.getElementById('no-task');
const activeTask = document.getElementById('active-task');
const taskName = document.getElementById('task-name');
const statCaptures = document.getElementById('stat-captures');
const statStatus = document.getElementById('stat-status');
const captureBtn = document.getElementById('capture-btn');
const logoutBtn = document.getElementById('logout-btn');

function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.add('visible');
}

function hideError() {
  loginError.classList.remove('visible');
}

function setLoading(loading) {
  if (loading) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner"></span> Signing in...';
  } else {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
}

async function checkStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'MINUTEFLOW_GET_STATUS' }, (response) => {
      resolve(response);
    });
  });
}

async function loadScreenshotCount() {
  try {
    const result = await chrome.storage.local.get(['mf_session']);
    const session = result.mf_session;
    if (!session?.access_token || !session?.user?.id) return '--';

    const today = new Date().toISOString().split('T')[0];
    const url = `https://tdaurfsglbxoutvdybjm.supabase.co/rest/v1/task_screenshots?user_id=eq.${session.user.id}&created_at=gte.${today}T00:00:00&select=id`;

    const resp = await fetch(url, {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYXVyZnNnbGJ4b3V0dmR5YmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDUyMTQsImV4cCI6MjA4OTUyMTIxNH0.88v232bVlqCb1UjL6XJ3rFrPA7-qA0yVrxOJXLh0eZw',
        'Authorization': `Bearer ${session.access_token}`,
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      return data.length.toString();
    }
  } catch (e) {
    console.error('[MinuteFlow] Screenshot count error:', e);
  }
  return '--';
}

async function loadActiveTaskName() {
  try {
    const result = await chrome.storage.local.get(['mf_session']);
    const session = result.mf_session;
    if (!session?.access_token || !session?.user?.id) return null;

    const url = `https://tdaurfsglbxoutvdybjm.supabase.co/rest/v1/sessions?user_id=eq.${session.user.id}&select=active_task`;

    const resp = await fetch(url, {
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYXVyZnNnbGJ4b3V0dmR5YmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDUyMTQsImV4cCI6MjA4OTUyMTIxNH0.88v232bVlqCb1UjL6XJ3rFrPA7-qA0yVrxOJXLh0eZw',
        'Authorization': `Bearer ${session.access_token}`,
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data[0]?.active_task) {
        return data[0].active_task;
      }
    }
  } catch (e) {
    console.error('[MinuteFlow] Active task error:', e);
  }
  return null;
}

async function loadDashboard(status) {
  if (!status || !status.loggedIn) {
    showLogin();
    return;
  }

  showDashboard();

  // User info
  const profile = status.profile;
  userName.textContent = profile?.full_name || status.user?.email?.split('@')[0] || 'User';
  userEmail.textContent = status.user?.email || '';

  // Status badge
  if (status.polling) {
    statusBadge.className = 'status-badge online';
    statusBadge.innerHTML = '<span class="status-dot online"></span> Connected';
  } else {
    statusBadge.className = 'status-badge offline';
    statusBadge.innerHTML = '<span class="status-dot offline"></span> Disconnected';
  }

  // Get active task from DB directly (more reliable than background state)
  const activeTaskData = await loadActiveTaskName();

  if (activeTaskData && (activeTaskData.logId || activeTaskData.log_id)) {
    noTask.classList.add('hidden');
    activeTask.classList.remove('hidden');
    taskName.textContent = activeTaskData.task_name || 'Active Task';
    statStatus.textContent = 'Active';
    statStatus.style.color = '#6b8f71';
    captureBtn.disabled = false;
  } else {
    noTask.classList.remove('hidden');
    activeTask.classList.add('hidden');
    statStatus.textContent = 'Idle';
    statStatus.style.color = '';
    captureBtn.disabled = false;
  }

  // Load screenshot count
  const count = await loadScreenshotCount();
  statCaptures.textContent = count;
}

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('Email and password are required');
    return;
  }

  setLoading(true);

  chrome.runtime.sendMessage({
    type: 'MINUTEFLOW_LOGIN',
    email,
    password,
  }, async (response) => {
    setLoading(false);

    if (response?.success) {
      const status = await checkStatus();
      loadDashboard(status);
    } else {
      showError(response?.error || 'Login failed');
    }
  });
});

// Manual Capture
captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  captureBtn.innerHTML = '<span class="spinner"></span> Capturing...';

  chrome.runtime.sendMessage({ type: 'MINUTEFLOW_MANUAL_CAPTURE' }, (response) => {
    setTimeout(async () => {
      captureBtn.disabled = false;
      const icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

      if (response?.success) {
        captureBtn.style.background = '#6b8f71';
        captureBtn.innerHTML = 'Captured!';
        // Update count
        const count = await loadScreenshotCount();
        statCaptures.textContent = count;
        setTimeout(() => {
          captureBtn.style.background = '';
          captureBtn.innerHTML = `${icon} Capture Now`;
        }, 1500);
      } else {
        captureBtn.style.background = '#c2694f';
        captureBtn.innerHTML = 'Failed - try again';
        setTimeout(() => {
          captureBtn.style.background = '';
          captureBtn.innerHTML = `${icon} Capture Now`;
        }, 1500);
      }
    }, 500);
  });
});

// Logout
logoutBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'MINUTEFLOW_LOGOUT' }, () => {
    showLogin();
  });
});

// Initialize + auto-refresh every 10 seconds
(async () => {
  // Always read version from manifest so it never drifts
  const versionEl = document.querySelector('.version');
  if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

  const status = await checkStatus();
  loadDashboard(status);

  // Auto-refresh popup every 10 seconds
  setInterval(async () => {
    const s = await checkStatus();
    if (s?.loggedIn) {
      const activeTaskData = await loadActiveTaskName();
      if (activeTaskData && (activeTaskData.logId || activeTaskData.log_id)) {
        noTask.classList.add('hidden');
        activeTask.classList.remove('hidden');
        taskName.textContent = activeTaskData.task_name || 'Active Task';
        statStatus.textContent = 'Active';
        statStatus.style.color = '#6b8f71';
      } else {
        noTask.classList.remove('hidden');
        activeTask.classList.add('hidden');
        statStatus.textContent = 'Idle';
        statStatus.style.color = '';
      }
      const count = await loadScreenshotCount();
      statCaptures.textContent = count;
    }
  }, 10000);
})();
