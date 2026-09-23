// MinuteFlow Desktop — main process.
//
// Owns two things the renderer (sandboxed, no Node access) can't do itself:
//   1. Full-screen / any-window capture via desktopCapturer — this is the
//      whole reason this app exists instead of the Chrome extension, which
//      can only ever see the active browser tab.
//   2. Encrypted-at-rest storage of the Supabase refresh token, via
//      safeStorage (OS keychain / DPAPI), so a login survives an app
//      restart without the token sitting around as plain text.
const { app, BrowserWindow, ipcMain, desktopCapturer, safeStorage, session, dialog, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { SUPABASE_URL, API_BASE } = require("./config");

const isDev = !app.isPackaged;
const AUTH_FILE = path.join(app.getPath("userData"), "auth.dat");
const ICON_PATH = path.join(__dirname, "..", "build", "icon.ico");

// Mirrors the web app's TopNav beforeunload warning (src/components/TopNav.tsx)
// for the same underlying complaint — quitting while still clocked in leaves
// time silently untracked. The renderer pushes this via
// window.mfDesktop.setClockedIn() whenever sessionRow.clocked_in changes
// (App.tsx); the main process can't read React state directly, and the
// close handler below needs an answer before the window is gone.
let isClockedIn = false;
ipcMain.on("mf:set-clocked-in", (_event, value) => {
  isClockedIn = Boolean(value);
});

// ── Single instance ──────────────────────────────────────────────────────
// Two launches sharing one userData dir (same OS user, e.g. the app opened
// twice) will otherwise race on reading/writing auth.dat — one process can
// see a half-written file mid-save from the other and fail to decrypt it,
// which looks like corruption but is really just two writers with no lock.
// The second launch hands off to the first instance's existing window
// instead of starting a second one.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// ── Content-Security-Policy ─────────────────────────────────────────────
// Electron flags a renderer with no CSP as a security risk (console warning
// visible with DevTools open) — this app handles an auth token and drives
// screen capture, so it gets a real one rather than staying unset.
// script-src needs 'unsafe-eval' and 'unsafe-inline' only in dev: Vite's dev
// server both evals module updates for HMR and injects an inline
// <script type="module"> React Fast Refresh preamble into index.html itself
// (not a src file, so 'unsafe-eval' alone still blocks it) — the production
// build (loaded from dist/ via file://) has no inline scripts and needs
// neither. connect-src is scoped to exactly what the renderer talks to:
// Supabase (auth + REST) and minuteflow.click (screenshot upload) — plus the
// Vite dev server's own origin and websocket for HMR in dev.
//
// Electron's own DevTools console still warns about this in dev ("no CSP or
// a policy with unsafe-eval enabled") — that check fires on 'unsafe-eval'
// specifically and is a known, unavoidable cost of Vite's dev-mode HMR (every
// Electron+Vite template hits it); it does not apply to the packaged build,
// which ships neither directive.
function buildCsp() {
  const scriptSrc = isDev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'";
  const connectSrc = isDev
    ? `'self' ${SUPABASE_URL} ${API_BASE} ws://localhost:5173 http://localhost:5173`
    : `'self' ${SUPABASE_URL} ${API_BASE}`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Attachment images preview via a Supabase Storage signed URL
    // (message-attachments' MESSAGE_ATTACHMENT_BUCKET), a different origin
    // from the app's own API calls.
    `img-src 'self' data: ${SUPABASE_URL}`,
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
}

// Tracks the single window so the flash-frame IPC handler (below) can reach
// it — this app only ever has the one.
let mainWindow = null;

// The X button hides to tray rather than quitting — a shift tracker is only
// useful if it's still running. `app.quit()` (the tray menu's Quit, or the OS
// actually terminating the app) sets this first via 'before-quit', which is
// what tells the close handler below "this one's for real, don't just hide."
let isQuitting = false;
app.on("before-quit", () => {
  isQuitting = true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#faf7f2", // --color-cream, avoids a white flash on load
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Intercept the close (X button, Alt+F4, etc.). `confirmedQuit` short-
  // circuits the dialog on the second pass once the user has actually said
  // yes — win.destroy() would also skip re-firing 'close', but destroy()
  // bypasses the renderer's own cleanup (e.g. saving in-flight state), so
  // this asks the window to close normally instead.
  let confirmedQuit = false;
  win.on("close", (e) => {
    if (!isQuitting) {
      // Not a real quit (X button / Alt+F4) — keep tracking in the background,
      // same as any other tray app. Reachable again via the tray icon.
      e.preventDefault();
      win.hide();
      maybeShowTrayHint();
      return;
    }
    if (confirmedQuit || !isClockedIn) return;
    e.preventDefault();

    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Quit Anyway", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Still clocked in",
      message: "You're still clocked in.",
      detail: "Quitting now stops time tracking without clocking out. Quit anyway?",
    });

    if (choice === 0) {
      confirmedQuit = true;
      win.close();
    } else {
      // Backed out of quitting — a later X click should hide to tray again,
      // not re-open this same dialog with nothing left to confirm.
      isQuitting = false;
    }
  });

  // Flashing the taskbar icon on a new notification (see mf:flash-frame
  // below) means nothing if it never stops — clear it the moment the window
  // is actually looked at again.
  win.on("focus", () => win.flashFrame(false));

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Tray ─────────────────────────────────────────────────────────────────
let tray = null;
let hasShownTrayHint = false;

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("MinuteFlow");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open MinuteFlow", click: showMainWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("click", showMainWindow);
}

// One-time balloon the first time the window is hidden to tray in a session
// — otherwise closing the window looks like it quit the app with nothing
// explaining where it went.
function maybeShowTrayHint() {
  if (hasShownTrayHint || !tray || process.platform !== "win32") return;
  hasShownTrayHint = true;
  tray.displayBalloon({
    title: "MinuteFlow is still running",
    content: "Still tracking in the background. Click the tray icon to reopen, or Quit from there to fully exit.",
    icon: nativeImage.createFromPath(ICON_PATH),
  });
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const csp = buildCsp();
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
        },
      });
    });

    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Closing to tray means the window is hidden, not destroyed, so this only
// fires on a real quit (all windows actually closed) — nothing extra needed
// here beyond the existing default.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── Screen capture ──────────────────────────────────────────────────────
// Lists capturable sources (every monitor, plus every open window — not just
// this app's own window). The renderer picks one and calls getUserMedia with
// its id; the actual pixel grab happens there since desktopCapturer only
// hands out source *descriptors*; getUserMedia does the pixel readback.
ipcMain.handle("mf:get-screen-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
  }));
});

// ── Notifications ────────────────────────────────────────────────────────
// The toast itself is just the standard web Notification API, called
// directly from the renderer (NotificationBell.tsx) — Electron implements it
// natively, no IPC needed. This is the one extra thing only a real desktop
// app can do: flash the taskbar icon on a new item when the window isn't
// focused, the same attention-getter chat apps use. Cleared by the "focus"
// listener in createWindow() above.
ipcMain.on("mf:flash-frame", () => {
  if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});

// ── Launch at startup ────────────────────────────────────────────────────
// Opt-in, toggled from the UI (App.tsx) — reads/writes the OS's own login-
// item registration rather than anything this app tracks itself, so it stays
// correct even if the user changes it outside the app (Task Manager's
// Startup tab, System Settings).
ipcMain.handle("mf:get-launch-at-startup", () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("mf:set-launch-at-startup", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return app.getLoginItemSettings().openAtLogin;
});

// ── Encrypted session storage ───────────────────────────────────────────
ipcMain.handle("mf:auth-save", (_event, authSession) => {
  if (!safeStorage.isEncryptionAvailable()) {
    // Falls back to writing plaintext rather than silently losing the
    // session — only reachable on a machine with no OS credential store,
    // which auto-login on Windows/macOS always has.
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authSession), "utf8");
    return { encrypted: false };
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(authSession));
  fs.writeFileSync(AUTH_FILE, encrypted);
  return { encrypted: true };
});

ipcMain.handle("mf:auth-load", () => {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return JSON.parse(safeStorage.decryptString(raw));
      } catch {
        // Wasn't encrypted (older plaintext fallback file) — try reading as-is.
        return JSON.parse(raw.toString("utf8"));
      }
    }
    return JSON.parse(raw.toString("utf8"));
  } catch (err) {
    console.error("[MinuteFlow] Failed to load stored session:", err);
    return null;
  }
});

ipcMain.handle("mf:auth-clear", () => {
  try {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  } catch (err) {
    console.error("[MinuteFlow] Failed to clear stored session:", err);
  }
});
