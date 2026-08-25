const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deepseekDesktop', {
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.1'
});
