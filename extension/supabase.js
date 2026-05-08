/**
 * MinuteFlow Supabase Client for Chrome Extension
 *
 * Lightweight wrapper around the Supabase REST API.
 * We avoid bundling the full @supabase/supabase-js SDK to keep the extension
 * small and avoid build tooling. Instead, we talk directly to the PostgREST
 * and Storage APIs using fetch().
 */

const SUPABASE_URL = 'https://tdaurfsglbxoutvdybjm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYXVyZnNnbGJ4b3V0dmR5YmptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDUyMTQsImV4cCI6MjA4OTUyMTIxNH0.88v232bVlqCb1UjL6XJ3rFrPA7-qA0yVrxOJXLh0eZw';

/**
 * Get stored auth session from chrome.storage.local
 */
async function getSession() {
  const result = await chrome.storage.local.get(['mf_session']);
  return result.mf_session || null;
}

/**
 * Store auth session
 */
async function setSession(session) {
  await chrome.storage.local.set({ mf_session: session });
}

/**
 * Clear auth session
 */
async function clearSession() {
  await chrome.storage.local.remove(['mf_session']);
}

/**
 * Get auth headers for Supabase requests
 */
async function getAuthHeaders() {
  const session = await getSession();
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

/**
 * Sign in with email/password
 */
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.msg || `Login failed (${res.status})`);
  }

  const data = await res.json();
  await setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    user: data.user,
  });

  return data;
}

/**
 * Refresh the access token if expired
 */
async function refreshToken() {
  const session = await getSession();
  if (!session?.refresh_token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) {
    // Only clear session on actual auth failures (bad/expired credentials)
    // For network errors or temporary failures, keep the session and retry next time
    if (res.status === 400 || res.status === 401) {
      await clearSession();
    }
    return null;
  }

  const data = await res.json();
  const newSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    user: data.user,
  };
  await setSession(newSession);
  return newSession;
}

/**
 * Ensure we have a valid access token, refreshing if needed
 */
async function ensureAuth() {
  let session = await getSession();
  if (!session) return null;

  // Refresh if token expires within 60 seconds
  if (session.expires_at && Date.now() > session.expires_at - 60000) {
    session = await refreshToken();
  }

  return session;
}

/**
 * Sign out
 */
async function signOut() {
  const headers = await getAuthHeaders();
  // Best-effort server sign-out
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers,
    });
  } catch (_) {
    // Ignore errors — we clear locally regardless
  }
  await clearSession();
}

/**
 * PostgREST query helper
 */
async function query(table, { method = 'GET', filters = '', body = null, headers: extraHeaders = {} } = {}) {
  await ensureAuth();
  const headers = await getAuthHeaders();

  const opts = { method, headers: { ...headers, ...extraHeaders } };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  // For INSERT/PATCH, we want the response body back — but don't overwrite
  // if the caller already set a Prefer header (e.g. resolution=merge-duplicates)
  if (method === 'POST' && !opts.headers['Prefer']) {
    opts.headers['Prefer'] = 'return=representation';
  }
  if (method === 'PATCH' && !opts.headers['Prefer']) {
    opts.headers['Prefer'] = 'return=representation';
  }

  const url = `${SUPABASE_URL}/rest/v1/${table}${filters ? `?${filters}` : ''}`;
  const res = await fetch(url, opts);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Query failed: ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

/**
 * Upload a screenshot blob to Supabase Storage
 * Returns the storage path
 */
async function uploadScreenshot(blob, filename) {
  await ensureAuth();
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');

  const storagePath = `${session.user.id}/${filename}`;
  const url = `${SUPABASE_URL}/storage/v1/object/screenshots/${storagePath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': blob.type || 'image/png',
      'x-upsert': 'true',
    },
    body: blob,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed: ${res.status}`);
  }

  return storagePath;
}

/**
 * Get a signed URL for a screenshot (1 hour expiry)
 */
async function getSignedUrl(storagePath) {
  await ensureAuth();
  const headers = await getAuthHeaders();

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/screenshots/${storagePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expiresIn: 3600 }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
}

// Export for use in other extension scripts via importScripts or dynamic import
// In Manifest V3 service worker context, we use globalThis
if (typeof globalThis !== 'undefined') {
  globalThis.MinuteFlowDB = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    getSession,
    setSession,
    clearSession,
    getAuthHeaders,
    signIn,
    signOut,
    refreshToken,
    ensureAuth,
    query,
    uploadScreenshot,
    getSignedUrl,
  };
}
