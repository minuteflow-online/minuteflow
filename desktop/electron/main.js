// MinuteFlow Desktop — main process.
//
// Owns two things the renderer (sandboxed, no Node access) can't do itself:
//   1. Full-screen / any-window capture via desktopCapturer — this is the
//      whole reason this app exists instead of the Chrome extension, which
//      can only ever see the active browser tab.
//   2. Encrypted-at-rest storage of the Supabase refresh token, via
//      safeStorage (OS keychain / DPAPI), so a login survives an app
//      restart without the token sitting around as plain text.
const { app, BrowserWindow, ipcMain, desktopCapturer, safeStorage, session, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { SUPABASE_URL, API_BASE } = require("./config");

const isDev = !app.isPackaged;
const AUTH_FILE = path.join(app.getPath("userData"), "auth.dat");

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
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#faf7f2", // --color-cream, avoids a white flash on load
    autoHideMenuBar: true,
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

  // Intercept the close (X button, Alt+F4, etc.) rather than the app quitting
  // silently mid-shift. `confirmedQuit` short-circuits the dialog on the
  // second pass once the user has actually said yes — win.destroy() would
  // also skip re-firing 'close', but destroy() bypasses the renderer's own
  // cleanup (e.g. saving in-flight state), so this asks the window to close
  // normally instead.
  let confirmedQuit = false;
  win.on("close", (e) => {
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
    }
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

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

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
