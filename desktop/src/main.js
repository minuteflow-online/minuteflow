const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./config");
const { fileStorageAdapter } = require("./sessionStore");
const webApiClient = require("./webApiClient");
const taskManager = require("./taskManager");
const realtimeSync = require("./realtimeSync");

let mainWindow;
let supabase;

// The logged-in user's profile fields needed for time_logs inserts (see
// taskManager.startTask). Set on login/getSession, cleared on logout.
let currentUser = null;

// Realtime subscription lifecycle (see realtimeSync.js) — started once we
// know who's logged in, torn down on logout so we don't leak channels across
// account switches.
let realtimeUnsubscribe = null;
let syncDebounceTimer = null;

function notifyRendererOfChange() {
  // The two channels (time_logs, sessions) can both fire for one logical
  // action (e.g. startTask closes+inserts a log AND upserts the session) —
  // coalesce those into a single renderer refresh instead of two back-to-back ones.
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sync:changed");
    }
  }, 250);
}

function startRealtimeSync() {
  stopRealtimeSync();
  if (!currentUser) return;
  realtimeUnsubscribe = realtimeSync.subscribeToUserChanges(supabase, currentUser.id, notifyRendererOfChange);
}

function stopRealtimeSync() {
  if (realtimeUnsubscribe) {
    realtimeUnsubscribe();
    realtimeUnsubscribe = null;
  }
  clearTimeout(syncDebounceTimer);
}

function createSupabaseClient() {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: fileStorageAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    resizable: true,
    title: "MinuteFlow",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "login.html"));
}

app.whenReady().then(() => {
  createSupabaseClient();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopRealtimeSync();
  if (process.platform !== "darwin") app.quit();
});

// --- Auth IPC ---

// Fetches the profile fields needed both for display and for time_logs inserts
// (username/department/position — see taskManager.startTask), and caches them
// in module-level `currentUser` for the rest of this process's lifetime.
async function buildLoggedInUser(authUser) {
  const result = {
    id: authUser.id,
    email: authUser.email,
    fullName: null,
    username: null,
    department: null,
    position: null,
  };
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username, department, position")
      .eq("id", authUser.id)
      .single();
    if (profile) {
      result.fullName = profile.full_name ?? null;
      result.username = profile.username ?? null;
      result.department = profile.department ?? null;
      result.position = profile.position ?? null;
    }
  } catch {
    // Dashboard still works with just the email; task-start will fail later
    // with a clear error if username/etc turned out to be required and missing.
  }
  currentUser = result;
  startRealtimeSync();
  return result;
}

ipcMain.handle("auth:login", async (_event, { email, password }) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, error: error?.message || "Login failed." };
  }
  return { ok: true, user: await buildLoggedInUser(data.user) };
});

ipcMain.handle("auth:logout", async () => {
  stopRealtimeSync();
  await supabase.auth.signOut();
  currentUser = null;
  return { ok: true };
});

ipcMain.handle("auth:getSession", async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { ok: false };

  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return { ok: false };

  return { ok: true, user: await buildLoggedInUser(userData.user) };
});

// --- Navigation IPC ---

ipcMain.handle("nav:goDashboard", () => {
  mainWindow.loadFile(path.join(__dirname, "renderer", "dashboard.html"));
});

ipcMain.handle("nav:goLogin", () => {
  mainWindow.loadFile(path.join(__dirname, "renderer", "login.html"));
});

// --- Session/Task IPC ---
// See taskManager.js for the Clock In/Out + single-active-task race-condition handling.

// organization_settings.timezone rarely changes — cache it for this process
// instead of re-querying on every task start (same value dashboard/page.tsx
// loads into its `orgTimezone` state on initial load).
let orgTimezoneCache = null;
async function getOrgTimezone() {
  if (orgTimezoneCache) return orgTimezoneCache;
  try {
    const { data } = await supabase.from("organization_settings").select("timezone").limit(1).single();
    orgTimezoneCache = data?.timezone || "UTC";
  } catch {
    orgTimezoneCache = "UTC";
  }
  return orgTimezoneCache;
}

async function getSessionRow() {
  if (!currentUser) return null;
  return taskManager.getSessionState(supabase, currentUser.id);
}

function taskDeps() {
  return { supabase, webApiClient, currentUser, getSessionRow, getOrgTimezone };
}

ipcMain.handle("tasks:list", async () => {
  try {
    const tasks = await taskManager.listTasks(webApiClient);
    return { ok: true, tasks };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:start", async (_event, task) => {
  return taskManager.startTask(taskDeps(), task);
});

ipcMain.handle("tasks:getActive", async () => {
  if (!currentUser) return { ok: false, error: "Not logged in." };
  try {
    const activeTask = await taskManager.getActiveTask(supabase, currentUser.id);
    return { ok: true, activeTask };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("session:getState", async () => {
  if (!currentUser) return { ok: false, error: "Not logged in." };
  try {
    const session = await taskManager.getSessionState(supabase, currentUser.id);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("session:clockIn", async () => {
  return taskManager.clockIn(taskDeps());
});

ipcMain.handle("session:clockOut", async () => {
  return taskManager.performClockOut(taskDeps());
});

ipcMain.handle("session:closeTaskAndClockOut", async (_event, payload) => {
  return taskManager.closeTaskAndClockOut(taskDeps(), payload);
});

// --- New for the 1d layout: task table + today's-tracked stat ---
// All three are thin additions on top of already-existing functions
// (webApiClient.fetchAssignedTasksSelf/patchAssignedTaskStatus, the same
// today-in-org-timezone idiom used elsewhere) — no session/task-start logic
// is duplicated or changed here.

ipcMain.handle("tasks:listQueued", async () => {
  try {
    const tasks = await taskManager.listQueuedTasks(webApiClient);
    return { ok: true, tasks };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- New for spec 1e: to-do items scoped to an already-queued task ---
// (task creation itself was removed — see the deleted renderer/taskForm.js
// and the Log a Task form markup that used to live in dashboard.html)

ipcMain.handle("tasks:addTodo", async (_event, { assignedTaskId, text }) => {
  if (!currentUser) return { ok: false, error: "Not logged in." };
  try {
    const todo = await webApiClient.addTaskTodo(assignedTaskId, text);
    return { ok: true, todo };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:setStatus", async (_event, { assignedTaskId, status }) => {
  if (!currentUser) return { ok: false, error: "Not logged in." };
  try {
    const ok = await webApiClient.patchAssignedTaskStatus(assignedTaskId, {
      status,
      va_id: currentUser.id,
    });
    return ok ? { ok: true } : { ok: false, error: "Update was rejected by the server." };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("stats:getTodayTracked", async () => {
  if (!currentUser) return { ok: false, error: "Not logged in." };
  try {
    const orgTimezone = await getOrgTimezone();
    const trackedMs = await taskManager.getTodayTrackedMs(supabase, currentUser.id, orgTimezone);
    return { ok: true, trackedMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
