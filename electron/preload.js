const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chessist', {
  isDesktop: true,
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke('status:get'),
  getEngineSettings: () => ipcRenderer.invoke('engine:get'),
  setEngineOption: (key, value) => ipcRenderer.invoke('engine:set', { key, value }),
  getGameSettings: () => ipcRenderer.invoke('game:get'),
  setGameOption: (key, value) => ipcRenderer.invoke('game:set', { key, value }),
  getSidebarShortcuts: () => ipcRenderer.invoke('sidebar:get-shortcuts'),
  setSidebarShortcuts: (ids) => ipcRenderer.invoke('sidebar:set-shortcuts', ids),
  redownloadStockfish: () => ipcRenderer.invoke('stockfish:redownload'),
  runPerformanceCheck: () => ipcRenderer.invoke('performance:run'),
  onPerformancePhase: (cb) => {
    const listener = (_event, phase) => cb(phase)
    ipcRenderer.on('performance:phase', listener)
    return () => ipcRenderer.removeListener('performance:phase', listener)
  },
  onPerformanceFrame: (cb) => {
    const listener = (_event, frame) => cb(frame)
    ipcRenderer.on('performance:frame', listener)
    return () => ipcRenderer.removeListener('performance:frame', listener)
  },
  finishPerformanceFrame: (id, result) => ipcRenderer.send('performance:frame-finished', id, result),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  getExtensionPath: () => ipcRenderer.invoke('extension:path'),
  revealExtensionFolder: () => ipcRenderer.invoke('extension:reveal'),
  getFirefoxPath: () => ipcRenderer.invoke('extension:firefox-path'),
  revealFirefoxFolder: () => ipcRenderer.invoke('extension:firefox-reveal'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: (expectedTag) => ipcRenderer.invoke('update:apply', expectedTag),
  getBeta: () => ipcRenderer.invoke('update:get-beta'),
  setBeta: (beta) => ipcRenderer.invoke('update:set-beta', beta),
  onUpdateLog: (cb) => {
    const h = (_e, line) => cb(line)
    ipcRenderer.on('update:log', h)
    return () => ipcRenderer.removeListener('update:log', h)
  },
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizedChange: (cb) => {
    const listener = (_event, maximized) => cb(maximized)
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },
  toggleDevTools: () => ipcRenderer.invoke('app:toggle-devtools'),
  onStatus: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('status', h)
    return () => ipcRenderer.removeListener('status', h)
  },
  onEval: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('eval', h)
    return () => ipcRenderer.removeListener('eval', h)
  },
  onPosition: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('position', h)
    return () => ipcRenderer.removeListener('position', h)
  },
})
