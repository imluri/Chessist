const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: callback => {
    const listener = (_event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },
})
