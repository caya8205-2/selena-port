// Bridge between the shell page and the supervisor in main.js.
// Only these calls exist; the page never gets node or raw IPC.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('selena', {
  status: () => ipcRenderer.invoke('stack:status'),
  start: () => ipcRenderer.invoke('stack:start'),
  stop: () => ipcRenderer.invoke('stack:stop'),
  launch: () => ipcRenderer.invoke('stack:launch'),
  logs: () => ipcRenderer.invoke('stack:logs'),
  config: () => ipcRenderer.invoke('stack:config'),
  open: (url) => ipcRenderer.invoke('stack:open', url),
  onLog: (handler) => ipcRenderer.on('stack:log', (_event, line) => handler(line)),
})