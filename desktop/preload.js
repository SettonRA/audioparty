'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  getVersion:      () => ipcRenderer.invoke('get-version'),
  platform: process.platform
});
