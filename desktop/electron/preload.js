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
});
