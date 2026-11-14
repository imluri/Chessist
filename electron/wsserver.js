const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { createInterface } = require('node:readline')

const PORT = 27301
const DISCONNECTED = {
  extensionConnected: false,
  extensionUpdateAvailable: false,
  chessConnected: false,
  chessSite: null,
}

// Electron supervises the Bun service and subscribes to UI events. Browser
// requests and the Stockfish process stay entirely within the Bun service.
class Bridge {
  constructor(onComponent, {
    port = PORT, executable, game = {}, engine = {}, versions = {},
    onPosition, onEval, onAutoMoveStatus, onOverlay, onEngineStatus,
  } = {}) {
    this.onComponent = onComponent
    this.onPosition = onPosition
    this.onEval = onEval
    this.onAutoMoveStatus = onAutoMoveStatus
    this.onOverlay = onOverlay
    this.onEngineStatus = onEngineStatus
    this.port = port
    this.executable = executable
    this.game = { ...game }
    this.engine = { ...engine }
    this.versions = { ...versions }
    this.stockfish = { status: 'starting', message: '' }
    this.enginePath = null
    this.worker = null
    this.restartTimer = null
    this.restarts = 0
    this.nextRequestId = 1
  }

  async start() {
    clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (this.worker?.stopping) await this.worker.closed
    if (this.worker) return this.worker.ready
    this.restarts = 0
    return this._launch()
  }

  _launch() {
    const bun = join(__dirname, '..', 'node_modules', 'bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
    const args = this.executable ? [String(this.port)] : [join(__dirname, 'bun-ws-worker.cjs'), String(this.port)]
    const env = { ...process.env }
    delete env.BUN_BE_BUN
    const child = spawn(this.executable || bun, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let resolveReady, rejectReady, resolveClosed
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const closed = new Promise(resolve => { resolveClosed = resolve })
    const worker = { child, ready, closed, stopping: false, pending: new Map() }
    this.worker = worker

    let started = false
    let failure
    let stderr = ''
    const timeout = setTimeout(() => {
      failure = 'The local service did not start in time.'
      child.kill()
    }, 5000)

    child.on('error', error => { failure ??= error.message })
    child.stdin.on('error', () => {}) // A worker can exit while a write is queued.
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2048) })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      if (worker.stopping) return
      let event
      try { event = JSON.parse(line) } catch { return }
      const { type, data } = event
      switch (type) {
        case 'ready':
          started = true
          clearTimeout(timeout)
          this.onComponent?.({ wsError: null })
          resolveReady(event.port)
          break
        case 'component': this.onComponent?.(data); break
        case 'position': this.onPosition?.(data); break
        case 'overlay': this.onOverlay?.(data); break
        case 'eval': this.onEval?.(data); break
        case 'auto-move-status': this.onAutoMoveStatus?.(data); break
        case 'engine-status': this._setStatus(data); break
        case 'fatal': failure = event.message; break
        case 'result': {
          const request = worker.pending.get(event.requestId)
          if (!request) break
          if (event.ok) request.resolve(data)
          else request.reject(new Error(event.error || 'Stockfish command failed.'))
          break
        }
      }
    })

    child.once('close', (code, signal) => {
      lines.close()
      clearTimeout(timeout)
      this.worker = null
      const message = failure || stderr.trim() || `WebSocket worker exited (${signal || code}).`
      const error = new Error(worker.stopping ? 'The local service stopped.' : message)
      for (const request of worker.pending.values()) request.reject(error)
      if (!started) rejectReady(error)
      resolveClosed()
      if (worker.stopping) return
      this.onComponent?.({ ...DISCONNECTED, wsError: message })
      const restarting = (started || this.restarts) && this.restarts < 3
      if (this.enginePath) {
        this._setStatus(restarting
          ? { status: 'starting', message: 'Stockfish: reconnecting…' }
          : { status: 'error', message: 'Stockfish: the local service stopped.' })
      }
      if (restarting) {
        this.restarts += 1
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          this._launch().catch(() => {}) // Component status already shows the failure.
        }, 500 * this.restarts)
      }
    })

    this._send({
      type: 'configure', game: this.game, engine: this.engine, versions: this.versions,
      stockfishState: this.stockfish.status, stockfishMessage: this.stockfish.message,
    })
    if (this.enginePath) this._send({ type: 'engine-start', path: this.enginePath })
    return ready
  }

  _send(command) {
    const worker = this.worker
    if (!worker || worker.stopping || !worker.child.stdin.writable) return false
    worker.child.stdin.write(JSON.stringify(command) + '\n')
    return true
  }

  _setStatus(status) {
    this.stockfish = status
    this.onEngineStatus?.(status)
  }

  broadcastStatus(status) {
    this._setStatus(status)
    this._send({ type: 'stockfish-status', ...status })
  }

  broadcastSettings(settings) {
    this.game = { ...settings }
    this._send({ type: 'game-settings', data: this.game })
  }

  applyEngineSetting(key, value) {
    this.engine[key] = value
    this._send({ type: 'engine-setting', key, value })
  }

  startEngine(path) {
    this.enginePath = path
    this._send({ type: 'engine-start', path })
  }

  async killEngine() {
    this.enginePath = null
    const worker = this.worker
    if (!worker) return
    if (worker.stopping) return worker.closed
    return this._request({ type: 'engine-kill' }, 5000)
  }

  benchmarkStockfish() {
    if (!this.enginePath) throw new Error('Stockfish is not installed.')
    return this._request({ type: 'performance-stockfish', path: this.enginePath }, 30000, 'performance-cancel')
  }

  async _request(command, timeoutMs, cancelType) {
    const worker = this.worker
    if (!worker || worker.stopping) throw new Error('The local service is unavailable.')
    const requestId = this.nextRequestId++
    let timeout
    try {
      return await new Promise((resolve, reject) => {
        worker.pending.set(requestId, { resolve, reject })
        timeout = setTimeout(() => {
          if (cancelType && this.worker === worker) this._send({ type: cancelType, requestId })
          reject(new Error('The local service did not finish the request in time.'))
        }, timeoutMs)
        if (!this._send({ ...command, requestId })) reject(new Error('The local service stopped.'))
      })
    } finally {
      clearTimeout(timeout)
      worker.pending.delete(requestId)
    }
  }

  async stop() {
    clearTimeout(this.restartTimer)
    this.restartTimer = null
    const worker = this.worker
    if (!worker) return
    if (worker.stopping) return worker.closed
    worker.stopping = true
    worker.child.stdin.end()
    const timeout = setTimeout(() => worker.child.kill(), 2000)
    await worker.closed
    clearTimeout(timeout)
  }
}

module.exports = { Bridge, PORT }
