const { contextBridge, ipcRenderer } = require('electron')

const apiBase = ipcRenderer.sendSync('get-api-base')
const initialCatalog = ipcRenderer.sendSync('get-initial-catalog')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  apiBase,
  initialCatalog,
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),
  syncTheme: (theme) => ipcRenderer.send('set-ui-theme', theme),
  windowMinimize: () => ipcRenderer.send('win-minimize'),
  windowMaximize: () => ipcRenderer.send('win-maximize'),
  windowClose: () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  onMaximizedChange: (cb) => {
    const handler = (_ev, val) => cb(Boolean(val))
    ipcRenderer.on('win-maximized-changed', handler)
    return () => ipcRenderer.removeListener('win-maximized-changed', handler)
  },
  setFullScreen: (flag) => ipcRenderer.send('win-set-fullscreen', Boolean(flag)),
  setMinimizeToTray: (flag) => ipcRenderer.send('set-minimize-to-tray', Boolean(flag)),
  setRadioActive: (active) => ipcRenderer.send('set-radio-active', Boolean(active)),
  onFullScreenChange: (cb) => {
    const handler = (_ev, val) => cb(Boolean(val))
    ipcRenderer.on('win-fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('win-fullscreen-changed', handler)
  },
  onMediaCommand: (cb) => {
    const handler = (_ev, cmd) => cb(cmd)
    ipcRenderer.on('media-command', handler)
    return () => ipcRenderer.removeListener('media-command', handler)
  },
  saveImageDataUrl: (dataUrl, defaultName) =>
    ipcRenderer.invoke('save-image-data-url', { dataUrl, defaultName }),
  importLocalFile: () => ipcRenderer.invoke('import-local-file'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
})
