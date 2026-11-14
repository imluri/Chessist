const { performance } = require('node:perf_hooks')
const { setTimeout: sleep } = require('node:timers/promises')
const WebSocket = require('ws')

function summarize(samples) {
  const sorted = samples.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples: sorted.length,
  }
}

async function measureLoopback(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 2000 })
  const samples = []
  let pending
  socket.on('error', error => pending?.reject(error))
  socket.on('close', () => pending?.reject(new Error('The local connection closed.')))
  socket.on('message', raw => {
    let message
    try { message = JSON.parse(raw) } catch { return }
    if (message?.type === 'performance_pong' && pending && message.id === pending.id) {
      pending.resolve(performance.now() - pending.started)
    }
  })

  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
      socket.once('close', () => reject(new Error('The local connection closed.')))
    })
    for (let id = 0; id < 33; id++) {
      let timer
      try {
        const elapsed = await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('The local service did not reply.')), 1000)
          pending = { id, started: performance.now(), resolve, reject }
          socket.send(JSON.stringify({ type: 'performance_ping', id }))
        })
        if (id >= 3) samples.push(elapsed)
      } finally {
        clearTimeout(timer)
        pending = undefined
      }
    }
    return summarize(samples)
  } finally {
    socket.terminate()
  }
}

class PerformanceCheck {
  constructor(window, bridge) {
    this.window = window
    this.bridge = bridge
    this.sequence = 0
    this.pendingFrame = null
  }

  get active() {
    return !this.window.isDestroyed() && !this.window.webContents.isDestroyed()
  }

  _phase(phase) {
    if (this.active) this.window.webContents.send('performance:phase', phase)
  }

  async run({ skipStockfish = false } = {}) {
    const result = { local: null, stockfish: null, display: {}, warnings: [] }
    this._phase('local')
    try {
      const port = await this.bridge?.worker?.ready
      if (!port) throw new Error('The local service is not running.')
      result.local = await measureLoopback(port)
    } catch (error) {
      result.warnings.push(`Local connection: ${error.message}`)
    }

    if (this.active) {
      this._phase('stockfish')
      try {
        if (skipStockfish) throw new Error('Close connected chess tabs or finish Stockfish setup, then run the check again.')
        if (!this.bridge) throw new Error('The local service is not running.')
        const data = await this.bridge.benchmarkStockfish()
        result.stockfish = {
          first: summarize(data.firstEvalMs),
          fixed: summarize(data.fixedDepthMs),
          depth: data.depth,
        }
      } catch (error) {
        result.warnings.push(`Stockfish: ${error.message}`)
      }
    }

    result.display.foreground = await this._displayPhase('foreground', 2100)
    result.display.background = await this._displayPhase('background', 8000)
    if (this.active && !result.display.foreground) result.warnings.push('Foreground display: keep Chessist in focus and the sample in view during this phase.')
    if (this.active && !result.display.background) result.warnings.push('Background display: switch focus to another window while keeping the sample in view.')
    return result
  }

  async _displayPhase(phase, duration) {
    this._phase(phase)
    const until = performance.now() + duration
    const focused = phase === 'foreground'
    const samples = []
    while (this.active && performance.now() < until && samples.length < 15) {
      if (!this.window.isMinimized() && this.window.isFocused() === focused) {
        const elapsed = await this._measureFrame(focused)
        if (elapsed !== null) samples.push(elapsed)
      }
      if (performance.now() < until) await sleep(100)
    }
    return samples.length >= 5 ? summarize(samples) : null
  }

  _measureFrame(focused) {
    const id = ++this.sequence
    return new Promise(resolve => {
      const complete = value => {
        clearTimeout(timer)
        this.pendingFrame = null
        resolve(value)
      }
      const started = performance.now()
      const timer = setTimeout(() => complete(null), 400)
      this.pendingFrame = { id, focused, started, complete }
      try {
        this.window.webContents.send('performance:frame', { id, score: ((id % 41) / 10 - 2).toFixed(2) })
      } catch {
        complete(null)
      }
    })
  }

  finishFrame(sender, id, result) {
    const frame = this.pendingFrame
    if (!frame || frame.id !== id || !this.active || sender !== this.window.webContents) return
    const valid = result?.visible === true && result.focused === frame.focused &&
      !this.window.isMinimized() && this.window.isFocused() === frame.focused
    frame.complete(valid ? performance.now() - frame.started : null)
  }
}

module.exports = { PerformanceCheck, measureLoopback, summarize }
