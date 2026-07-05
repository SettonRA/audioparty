'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 900,
    minWidth: 500,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    title: 'AudioParty',
    icon: path.join(__dirname, 'renderer', 'assets', 'favicon.png'),
    backgroundColor: '#0f172a',
    show: false
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window only once content is loaded (avoids white flash)
  win.once('ready-to-show', () => win.show());

  // Open external links in the system browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigating away from the local renderer
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
}

// IPC: list available screen/window sources for audio capture
ipcMain.handle('get-audio-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    fetchWindowIcons: false
  });
  return sources.map(({ id, name }) => ({ id, name }));
});

// IPC: return the app version string
ipcMain.handle('get-version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
