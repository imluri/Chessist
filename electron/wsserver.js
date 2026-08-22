const { WebSocketServer } = require('ws')
const { createServer } = require('http')

const PORT = 27301

// Routes messages between the browser extension and the engine/overlay.
// Two kinds of extension clients:
//   - content (role:'content') — a content script on a chess tab (active game)
//   - presence (role:'extension') — the service worker (extension installed/running)
class Bridge {
  constructor(engine, overlay, onComponent) {
    this.engine = engine
    this.overlay = overlay
    this.onComponent = onComponent
    this.wss = null
    this.contentClients = new Set()   // chess tabs
    this.presenceClients = new Set()  // service worker(s)
    this.chessSite = null             // e.g. 'Chess.com' | 'Lichess'
    this.getGameSettings = null // set by main: () => gameSettings
    this.onPosition = null      // set by main: (msg) => void
  }

  _emit() {
    const chessConnected = this.contentClients.size > 0
    const extensionConnected = chessConnected || this.presenceClients.size > 0
    this.onComponent?.({ extensionConnected, chessConnected, chessSite: chessConnected ? this.chessSite : null })
  }

  start() {
    // Listen on BOTH loopback families (IPv4 127.0.0.1 AND IPv6 ::1). Some setups
    // resolve "localhost"/loopback to IPv6 first, so binding only 127.0.0.1 left the
    // extension's WebSocket refused (net::ERR_CONNECTION_REFUSED) even though netstat
    // showed the app listening. A shared noServer wss handles upgrades from either.
    this.wss = new WebSocketServer({ noServer: true })
    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => this._onMessage(ws, raw))
      ws.on('close', () => {
        const a = this.contentClients.delete(ws)
        const b = this.presenceClients.delete(ws)
        if (a || b) this._emit()
      })
    })
    const onUpgrade = (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req))
    }
    this._servers = []
    let listening = 0
    for (const host of ['127.0.0.1', '::1']) {
      const srv = createServer()
      srv.on('upgrade', onUpgrade)
      srv.on('error', (e) => {
        // EADDRINUSE on one family is fine as long as the other bound.
        if (e.code !== 'EADDRINUSE' && e.code !== 'EADDRNOTAVAIL') this.onComponent?.({ wsError: e.message })
      })
      srv.on('listening', () => { listening++ })
      try { srv.listen(PORT, host) } catch {}
      this._servers.push(srv)
    }

    // Heartbeat: ping every 20s. Incoming WS messages keep the MV3 service worker
    // alive (idle ~30s), so presence detection stays continuous regardless of tab.
    this._ping = setInterval(() => {
      for (const ws of this.wss?.clients ?? []) {
        if (ws.readyState === 1) { try { ws.send('{"type":"ping"}') } catch {} }
      }
    }, 20000)
  }

  _onMessage(ws, raw) {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    if (msg.type === 'identify') {
      if (msg.role === 'content') {
        this.contentClients.add(ws)
        if (msg.site) this.chessSite = msg.site
        // Push current game settings to the freshly connected content script.
        const data = this.getGameSettings?.()
        if (data) { try { ws.send(JSON.stringify({ type: 'settings', data })) } catch {} }
      } else {
        this.presenceClients.add(ws) // service worker presence
      }
      this._emit()
      return
    }
    // Current board position from a content script (authoritative; filters out
    // speculative pre-warm evals on the app side).
    if (msg.type === 'position') { this.onPosition?.({ fen: msg.fen, flipped: !!msg.flipped }); return }
    if (msg.type === 'ping' || msg.type === 'pong') return
    if (msg.type === 'evaluate') { this.engine.evaluate(msg.fen, msg.depth, msg.multiPv, msg.force === true); return }
    if (msg.type === 'set_option') { this.engine.setOption(msg.name, msg.value); return }
    if (msg.type === 'stop') { this.engine.stop(); return }
    // New game → reset the transposition table. Normal moves NEVER reset (hash is reused).
    if (msg.type === 'new_game') { this.engine.newGame(); return }
    // Overlay draw payload (no engine type) — has evalBar/arrows/positionOnly/visible
    if ('evalBar' in msg || 'arrows' in msg || 'positionOnly' in msg || 'visible' in msg) {
      this.overlay.draw(msg)
    }
  }

  broadcastEval(ev) {
    const data = JSON.stringify({ type: 'eval', data: ev })
    for (const ws of this.wss?.clients ?? []) {
      if (ws.readyState === 1) { try { ws.send(data) } catch {} }
    }
  }

  broadcastStatus(status) {
    const data = JSON.stringify({ type: 'engine_status', ...status })
    for (const ws of this.wss?.clients ?? []) {
      if (ws.readyState === 1) { try { ws.send(data) } catch {} }
    }
  }

  // Push game settings to connected content scripts.
  broadcastSettings(settings) {
    const data = JSON.stringify({ type: 'settings', data: settings })
    for (const ws of this.contentClients) {
      if (ws.readyState === 1) { try { ws.send(data) } catch {} }
    }
  }

  stop() {
    try { clearInterval(this._ping) } catch {}
    try { this.wss?.close() } catch {}
    for (const s of this._servers || []) { try { s.close() } catch {} }
  }
}

module.exports = { Bridge, PORT }
