const { spawn } = require('child_process')
const os = require('os')

function parseInfoLine(line) {
  const out = {}
  const depth = line.match(/\bdepth (\d+)/);            if (depth) out.depth = +depth[1]
  const mpv = line.match(/\bmultipv (\d+)/);            if (mpv) out.multipv = +mpv[1]
  const mate = line.match(/\bscore mate (-?\d+)/)
  const cp = line.match(/\bscore cp (-?\d+)/)
  if (mate) out.mate = +mate[1]
  else if (cp) out.cp = +cp[1]
  const nps = line.match(/\bnps (\d+)/);                if (nps) out.nps = +nps[1]
  const pv = line.match(/ pv (.+)$/)
  if (pv) { out.pv = pv[1].trim().split(/\s+/); out.bestMove = out.pv[0] }
  return (out.cp !== undefined || out.mate !== undefined) ? out : null
}

function defaultHashMb() {
  const freeMb = Math.floor(os.totalmem() / (1024 * 1024))
  return Math.max(128, Math.min(1024, Math.floor(freeMb / 8)))
}

class Engine {
  constructor(onEval, onStatus, opts = {}) {
    this.onEval = onEval
    this.onStatus = onStatus
    this.proc = null
    this.ready = false
    this.depth = 18
    this.multipv = 1
    this.curFen = null
    this.pvSlots = {}
    this.searching = false
    this.pendingEval = null
    this._stoppingForPending = false
    this._discardBestMove = false
    this._path = null         // stockfish path (for auto-restart)
    this._intentional = false // suppress restart on deliberate kill
    this._restarts = 0        // bounded auto-restart counter
    this.hashMb = opts.hashMb || defaultHashMb()
    this.threads = opts.threads || Math.max(1, os.cpus().length - 1)
    // Engine settings owned by the desktop app (Engine page). Re-applied on every
    // (re)start so they persist across engine restarts. Depth/MultiPV stay
    // extension-driven and are NOT stored here.
    this.settings = {
      skillLevel: opts.skillLevel ?? 20,
      limitStrength: opts.limitStrength ?? false,
      elo: opts.elo ?? 1500,
      threads: this.threads,
      hash: this.hashMb,
    }
  }

  start(stockfishPath) {
    if (stockfishPath) this._path = stockfishPath
    this._intentional = false
    const proc = spawn(this._path, [], { windowsHide: true })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    let buf = ''
    proc.stdout.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        this._handle(line)
      }
    })
    // Swallow stream errors (e.g. EPIPE when Stockfish dies mid-write) so they
    // never become an uncaught exception that crashes the app.
    proc.on('error', () => {})
    proc.stdin.on('error', () => {})
    proc.stdout.on('error', () => {})
    proc.on('exit', () => {
      this.ready = false
      this.searching = false
      this._stoppingForPending = false
      if (this.proc === proc) this.proc = null
      if (this._intentional) return
      this.onStatus?.({ status: 'error', message: 'Stockfish exited' })
      // Bounded auto-restart so a one-off crash recovers without looping forever.
      if (this._path && this._restarts < 3) {
        this._restarts++
        setTimeout(() => { if (!this.proc) this.start() }, 400)
      }
    })
    this._send('uci')
  }

  _send(cmd) {
    const p = this.proc
    if (!p || !p.stdin || !p.stdin.writable) return
    try { p.stdin.write(cmd + '\n') } catch {}
  }

  _handle(line) {
    if (line === 'uciok') {
      this._applySettings()
      this._send('setoption name MultiPV value 1')
      this._send('isready')
      return
    }
    if (line === 'readyok') {
      this.ready = true
      this._restarts = 0
      this.onStatus?.({ status: 'ready', message: 'Engine ready' })
      if (this.pendingEval && !this.searching) {
        const next = this.pendingEval
        this.pendingEval = null
        this._startEvaluation(next)
      }
      return
    }
    if (line.startsWith('info depth')) {
      const ev = parseInfoLine(line)
      if (ev) this._lastInfo = ev   // keep the latest, incl. depth-0 lines (checkmate reports mate 0)
      if (!ev || (ev.depth || 0) < 5) return
      const slot = ev.multipv || 1
      this.pvSlots[slot] = ev
      if (slot !== 1) return
      ev.fen = this.curFen
      ev.turn = this.curFen ? (this.curFen.split(' ')[1] || 'w') : 'w'
      ev.multiPvMoves = [1, 2, 3].map(i => this.pvSlots[i]?.pv?.[0]).filter(Boolean)
      this.onEval?.(ev)
      return
    }
    // Stockfish answers a finished position with no legal move. `score mate 0`
    // (side to move is in check) → checkmate; otherwise → stalemate/draw.
    if (line.startsWith('bestmove')) {
      const move = line.split(/\s+/)[1]
      this.searching = false
      this._stoppingForPending = false
      if (this._discardBestMove) {
        this._discardBestMove = false
        return
      }
      if (this.pendingEval) {
        const next = this.pendingEval
        this.pendingEval = null
        this._startEvaluation(next)
        return
      }
      if (move === '(none)' || move === '0000') {
        const turn = this.curFen ? (this.curFen.split(' ')[1] || 'w') : 'w'
        const mated = this._lastInfo && this._lastInfo.mate === 0
        this.onEval?.({
          fen: this.curFen,
          turn,
          gameOver: mated ? 'checkmate' : 'stalemate',
          // For checkmate, the side to move is mated → the other side wins.
          winner: mated ? (turn === 'w' ? 'b' : 'w') : null,
        })
      }
    }
  }

  evaluate(fen, depth, multipv, force = false) {
    if (!fen) return
    const request = {
      fen,
      depth: depth || this.depth,
      multipv: multipv || this.multipv,
    }
    if (!this.ready) {
      this.pendingEval = request
      return
    }
    if (this.searching) {
      const duplicate = fen === this.curFen && request.depth === this.depth && request.multipv === this.multipv
      if (duplicate && !force) return
      this.pendingEval = request
      if (!this._stoppingForPending) {
        this._stoppingForPending = true
        this._send('stop')
      }
      return
    }
    this._startEvaluation(request)
  }

  _startEvaluation({ fen, depth, multipv }) {
    this.depth = depth || this.depth
    if (multipv && multipv !== this.multipv) {
      this.multipv = multipv
      this._send(`setoption name MultiPV value ${multipv}`)
    }
    this.curFen = fen
    this.pvSlots = {}
    this._lastInfo = null
    this.searching = true
    this._stoppingForPending = false
    this._send('position fen ' + fen)
    this._send('go depth ' + this.depth)
  }

  newGame() {
    this.pendingEval = null
    if (this.searching) {
      this._discardBestMove = true
      this._send('stop')
    }
    this.searching = false
    this._stoppingForPending = false
    this.ready = false
    this._send('ucinewgame')
    this._send('isready')
    this.curFen = null
    this.pvSlots = {}
  }

  setOption(name, value) { this._send(`setoption name ${name} value ${value}`) }

  // Send all app-owned settings to the engine (called on each uciok).
  _applySettings() {
    const s = this.settings
    this._send(`setoption name Threads value ${s.threads}`)
    this._send(`setoption name Hash value ${s.hash}`)
    this._send(`setoption name Skill Level value ${s.skillLevel}`)
    this._send(`setoption name UCI_LimitStrength value ${s.limitStrength ? 'true' : 'false'}`)
    if (s.limitStrength) this._send(`setoption name UCI_Elo value ${s.elo}`)
  }

  getSettings() { return { ...this.settings } }

  // Update one app-owned setting; applies live and persists for the next restart.
  applySetting(key, value) {
    if (!(key in this.settings)) return
    this.settings[key] = value
    if (key === 'threads') this.threads = value
    if (key === 'hash') this.hashMb = value
    switch (key) {
      case 'skillLevel':    this.setOption('Skill Level', value); break
      case 'limitStrength': this.setOption('UCI_LimitStrength', value ? 'true' : 'false')
                            if (value) this.setOption('UCI_Elo', this.settings.elo); break
      case 'elo':           if (this.settings.limitStrength) this.setOption('UCI_Elo', value); break
      case 'threads':       this.setOption('Threads', value); break
      case 'hash':          this.setOption('Hash', value); break
    }
  }

  stop() { this.pendingEval = null; this._send('stop') }
  kill() { this._intentional = true; try { this.proc?.kill() } catch {} }
}

module.exports = { parseInfoLine, defaultHashMb, Engine }
