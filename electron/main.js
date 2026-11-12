const { app, BrowserWindow, ipcMain, Menu, shell, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const { ensureStockfish } = require('./stockfish')
const { Engine } = require('./engine')
const { Overlay } = require('./overlay')
const { Bridge } = require('./wsserver')
const updater = require('./updater')

// --prod (or CHESSIST_PROD=1) forces production mode when running unpacked from
// the cloned repo via the local Electron (install.bat) — loads dist/ instead of
// the Vite dev server.
const forceProd = process.argv.includes('--prod') || process.env.CHESSIST_PROD === '1'
const isDev = !app.isPackaged && !forceProd
let mainWindow = null
let engine = null
let overlay = null
let bridge = null
let stockfishTask = null
let updateInProgress = false

// ── Settings persistence (userData/chessist-settings.json) ──
// Game/display settings owned by the app and pushed to the extension over WS.
const gameSettings = {
  enabled: true,
  depth: 18,
  showBestMove: false,
  showOpponentBestMove: false,
  showAltArrows: false,    // default: only the best-move (purple) arrow
  autoMove: false,
  instantMove: false,
  autoMoveDelayMin: 0.1,
  autoMoveDelayMax: 0.3,
  renderMode: 'overlay',   // 'overlay' | 'browser' | 'electron'
  playerColor: 'auto',     // 'auto' | 'white' | 'black'
  // ── niche / advanced ──
  showMoveIcon: false,     // move-classification icons on the board
  smartTiming: true,       // human-like auto-move timing
  autoRematch: false,
  autoNewGame: false,
  stealthMode: true,       // suppress console logs
  wlBalance: false,        // win/loss balancing
  maxConsecutiveWins: 2,
  maxConsecutiveLosses: 3,
  throwRandom: false,      // randomly throw games
  lossRandom: false,
  targetAccuracy: 100,     // target move accuracy %
}

// App-level preferences (update channel, etc.).
const appPrefs = { betaUpdates: false, sidebarShortcuts: [] }

function normalizeSidebarShortcuts(ids) {
  if (!Array.isArray(ids)) return []
  const settings = { game: gameSettings, engine: engine?.getSettings() ?? {} }
  return [...new Set(ids.filter(id => {
    if (typeof id !== 'string') return false
    const [scope, key, extra] = id.split('.')
    return extra === undefined && Object.hasOwn(settings, scope) && Object.hasOwn(settings[scope], key)
  }))]
}

function settingsPath() { return path.join(app.getPath('userData'), 'chessist-settings.json') }
function loadAll() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {} } catch { return {} }
}
function saveAll({ engine: engineSettings = engine?.getSettings() ?? {}, game = gameSettings } = {}) {
  const file = settingsPath()
  const temp = file + '.tmp'
  try {
    fs.writeFileSync(temp, JSON.stringify({ engine: engineSettings, game, app: appPrefs }, null, 2))
    fs.renameSync(temp, file)
    return true
  } catch {
    try { fs.rmSync(temp, { force: true }) } catch {}
    return false
  }
}

const componentStatus = {
  stockfishOk: false,
  stockfishState: 'starting',
  overlayOk: false,
  extensionConnected: false,   // extension installed (service worker present)
  extensionUpdateAvailable: false,
  chessConnected: false,       // a chess tab (content script) is active
  chessSite: null,             // 'Chess.com' | 'Lichess' when a chess tab is active
  message: '',
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function pushStatus(patch) {
  Object.assign(componentStatus, patch)
  sendToRenderer('status', componentStatus)
}

function updateStockfishStatus({ status, message }) {
  const ready = status === 'ready'
  pushStatus({ stockfishOk: ready, stockfishState: status, message: ready ? '' : message })
  bridge?.broadcastStatus({ status, message })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 600, minWidth: 720, minHeight: 480,
    title: 'Chessist', backgroundColor: '#000000',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      backgroundThrottling: false,
    },
  })
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  mainWindow.webContents.on('did-finish-load', () => pushStatus({}))
  mainWindow.on('closed', () => { mainWindow = null })
}

function startSubsystems() {
  overlay = new Overlay(isDev, process.resourcesPath, (s) => pushStatus(s))
  engine = new Engine(
    (ev) => { bridge?.broadcastEval(ev); sendToRenderer('eval', ev) },
    updateStockfishStatus
  )
  // Restore saved settings before first start (engine applied on uciok).
  const saved = loadAll()
  Object.assign(engine.settings, saved.engine || {})
  Object.assign(gameSettings, saved.game || {})
  Object.assign(appPrefs, saved.app || {})
  appPrefs.sidebarShortcuts = normalizeSidebarShortcuts(appPrefs.sidebarShortcuts)
  bridge = new Bridge(engine, overlay, (c) => pushStatus(c))
  bridge.getGameSettings = () => gameSettings
  bridge.getStockfishState = () => componentStatus.stockfishState
  const extensionVersions = {
    chromium: readExtensionVersion(extensionDir()),
    firefox: readExtensionVersion(firefoxDir()),
  }
  bridge.getBundledExtensionVersion = (browser) => extensionVersions[browser]
  bridge.onPosition = (p) => sendToRenderer('position', p)
  bridge.start()
  overlay.start()

  prepareStockfish()
}

function prepareStockfish(redownload = false) {
  if (stockfishTask) return stockfishTask
  stockfishTask = (async () => {
    try {
      const userData = app.getPath('userData')
      if (redownload) {
        updateStockfishStatus({ status: 'downloading', message: 'Stockfish: re-downloading…' })
        await engine.kill()
        fs.rmSync(path.join(userData, 'stockfish.exe'), { force: true })
      }
      const sfPath = await ensureStockfish(userData, updateStockfishStatus)
      if (sfPath) engine.start(sfPath)
    } catch (e) {
      updateStockfishStatus({ status: 'error', message: `Stockfish setup failed: ${e.message}` })
    }
  })().finally(() => { stockfishTask = null })
  return stockfishTask
}

function registerIpc() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('status:get', () => componentStatus)
  ipcMain.handle('engine:get', () => engine?.getSettings() ?? {})
  ipcMain.handle('engine:set', (_e, { key, value }) => {
    const current = engine?.getSettings()
    if (!current || !Object.hasOwn(current, key)) throw new Error('Unknown engine setting.')
    if (!saveAll({ engine: { ...current, [key]: value } })) throw new Error('Could not save engine settings.')
    engine.applySetting(key, value)
    return engine.getSettings()
  })
  ipcMain.handle('game:get', () => gameSettings)
  ipcMain.handle('game:set', (_e, { key, value }) => {
    if (!Object.hasOwn(gameSettings, key)) throw new Error('Unknown game setting.')
    if (!saveAll({ game: { ...gameSettings, [key]: value } })) throw new Error('Could not save game settings.')
    gameSettings[key] = value
    bridge?.broadcastSettings(gameSettings)
    return gameSettings
  })
  ipcMain.handle('sidebar:get-shortcuts', () => appPrefs.sidebarShortcuts)
  ipcMain.handle('sidebar:set-shortcuts', (_e, ids) => {
    const previous = appPrefs.sidebarShortcuts
    appPrefs.sidebarShortcuts = normalizeSidebarShortcuts(ids)
    if (saveAll()) return appPrefs.sidebarShortcuts
    appPrefs.sidebarShortcuts = previous
    throw new Error('Could not save shortcuts.')
  })
  ipcMain.handle('stockfish:redownload', () => prepareStockfish(true))
  ipcMain.handle('update:get-beta', () => appPrefs.betaUpdates)
  ipcMain.handle('update:set-beta', (_e, beta) => { appPrefs.betaUpdates = !!beta; saveAll(); return appPrefs.betaUpdates })
  ipcMain.handle('update:check', () => updater.checkForUpdate(appPrefs.betaUpdates))
  ipcMain.handle('update:apply', async (_event, expectedTag) => {
    if (updateInProgress) return { ok: false, error: 'An update is already in progress.' }
    updateInProgress = true
    let result
    try {
      result = await updater.applyUpdate(appPrefs.betaUpdates, (line) => sendToRenderer('update:log', line), expectedTag)
      if (result.installer) setImmediate(() => app.quit())
      else if (result.ok) setTimeout(() => { app.relaunch(); app.exit(0) }, 1000)
      return result
    } finally {
      if (!result?.ok) updateInProgress = false
    }
  })
  ipcMain.handle('shell:open', (_e, url) => { try { shell.openExternal(url) } catch {} })
  ipcMain.handle('extension:path', () => extensionDir())
  ipcMain.handle('extension:reveal', () => { try { return shell.openPath(extensionDir()) } catch { return '' } })
  ipcMain.handle('extension:firefox-path', () => firefoxDir())
  ipcMain.handle('extension:firefox-reveal', () => { try { return shell.openPath(firefoxDir()) } catch { return '' } })
  ipcMain.handle('clipboard:write', (_e, text) => { try { clipboard.writeText(String(text)) } catch {} })
  ipcMain.handle('app:toggle-devtools', () => {
    const wc = mainWindow?.webContents
    if (!wc || wc.isDestroyed()) return false
    if (wc.isDevToolsOpened()) { wc.closeDevTools(); return false }
    wc.openDevTools({ mode: 'detach' }); return true
  })
}

// The bundled (or repo) browser-extension folder users load unpacked.
function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '..', 'extension')
}

// The Firefox-flavored copy (build with `npm run build:firefox`; shipped in prod).
function firefoxDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'firefox')
    : path.join(__dirname, '..', 'firefox')
}

function readExtensionVersion(directory) {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).version
  } catch {
    return null
  }
}

// Single instance: a second launch must not race for port 27301. If we can't get
// the lock, focus the existing window and quit this one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show(); mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    await updater.clearInstallerCache()
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()
    startSubsystems()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

app.on('before-quit', () => { engine?.kill().catch(() => {}); overlay?.kill(); bridge?.stop() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
