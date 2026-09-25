const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mobileController', {
  start: () => ipcRenderer.invoke('mobile:start'),
  stop: () => ipcRenderer.invoke('mobile:stop'),
  status: () => ipcRenderer.invoke('mobile:status'),
  onAxes: (callback) => { const listener = (_event, axes) => callback(axes); ipcRenderer.on('mobile-axes', listener); return () => ipcRenderer.removeListener('mobile-axes', listener); },
  onLost: (callback) => { const listener = () => callback(); ipcRenderer.on('mobile-lost', listener); return () => ipcRenderer.removeListener('mobile-lost', listener); },
  onCommand: (callback) => { const listener = (_event, command) => callback(command); ipcRenderer.on('mobile-command', listener); return () => ipcRenderer.removeListener('mobile-command', listener); },
  onStatus: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('mobile-status', listener); return () => ipcRenderer.removeListener('mobile-status', listener); },
});
