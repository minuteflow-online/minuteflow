const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mfAuth", {
  login: (email, password) => ipcRenderer.invoke("auth:login", { email, password }),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getSession: () => ipcRenderer.invoke("auth:getSession"),
  goDashboard: () => ipcRenderer.invoke("nav:goDashboard"),
  goLogin: () => ipcRenderer.invoke("nav:goLogin"),
});

contextBridge.exposeInMainWorld("mfTasks", {
  list: () => ipcRenderer.invoke("tasks:list"),
  listQueued: () => ipcRenderer.invoke("tasks:listQueued"),
  start: (task) => ipcRenderer.invoke("tasks:start", task),
  getActive: () => ipcRenderer.invoke("tasks:getActive"),
  setStatus: (assignedTaskId, status) => ipcRenderer.invoke("tasks:setStatus", { assignedTaskId, status }),
  addTodo: (assignedTaskId, text) => ipcRenderer.invoke("tasks:addTodo", { assignedTaskId, text }),
});

contextBridge.exposeInMainWorld("mfSession", {
  getState: () => ipcRenderer.invoke("session:getState"),
  clockIn: () => ipcRenderer.invoke("session:clockIn"),
  clockOut: () => ipcRenderer.invoke("session:clockOut"),
  closeTaskAndClockOut: (payload) => ipcRenderer.invoke("session:closeTaskAndClockOut", payload),
});

contextBridge.exposeInMainWorld("mfStats", {
  getTodayTracked: () => ipcRenderer.invoke("stats:getTodayTracked"),
});

contextBridge.exposeInMainWorld("mfSync", {
  // Fires whenever time_logs/sessions change for this user (realtimeSync.js).
  // Returns an unsubscribe function.
  onChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("sync:changed", handler);
    return () => ipcRenderer.removeListener("sync:changed", handler);
  },
});
