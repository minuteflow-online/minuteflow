// Exposes a small, explicit API to the renderer — nodeIntegration stays off
// and contextIsolation stays on, so this is the only bridge to Node/Electron
// the UI code gets.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mfDesktop", {
  getScreenSources: () => ipcRenderer.invoke("mf:get-screen-sources"),
  auth: {
    save: (session) => ipcRenderer.invoke("mf:auth-save", session),
    load: () => ipcRenderer.invoke("mf:auth-load"),
    clear: () => ipcRenderer.invoke("mf:auth-clear"),
  },
  // One-way — the main process just needs the latest value to decide whether
  // to warn on quit, no response expected.
  setClockedIn: (value) => ipcRenderer.send("mf:set-clocked-in", value),
  // Flashes the taskbar icon — main process no-ops this if the window is
  // already focused. Used alongside a native Notification() (called directly
  // in the renderer, no bridge needed for that part) when a new item arrives.
  flashFrame: () => ipcRenderer.send("mf:flash-frame"),
  // Reads/writes the OS's own "run at login" registration — see main.js's
  // mf:get/set-launch-at-startup handlers.
  getLaunchAtStartup: () => ipcRenderer.invoke("mf:get-launch-at-startup"),
  setLaunchAtStartup: (enabled) => ipcRenderer.invoke("mf:set-launch-at-startup", enabled),
});
