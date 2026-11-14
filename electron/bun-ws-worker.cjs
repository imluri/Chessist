const { createInterface } = require('node:readline')
const { write } = require('node:fs')
const { Engine } = require('./engine')
const { benchmarkStockfish } = require('./performance-stockfish')

const MAX_PAYLOAD = 256 * 1024
const MAX_PENDING_OVERLAY_BYTES = 1024 * 1024
const BROADCAST_TOPIC = 'all'
const SNAPSHOT_REPORTS = new Set(['eval', 'position', 'component', 'auto-move-status'])
const EXTENSION_VERSION = /^\d{1,5}(?:\.\d{1,5}){0,3}$/
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/
const MOVE_STATES = new Set(['sending', 'confirmed', 'unchanged', 'changed', 'unverified', 'dispatch_error'])
const FEN_PLACEMENT = /^[prnbqkPRNBQK1-8]{1,8}(?:\/[prnbqkPRNBQK1-8]{1,8}){7}$/
const contentClients = new Map()
const presenceClients = new Map()
const servers = []
const reports = new Map()
let gameSettings
let versions = {}
let stockfishState = 'starting'
let heartbeat
let stopping = false
let outputBlocked = false
let pendingOverlayBytes = 0
let benchmark
let moveStatusSource

const BENCHMARK_BOARD_ERROR = 'Close chess boards connected to Chessist before running the Stockfish benchmark.'

function runBenchmark({ requestId, path }) {
  if (contentClients.size || benchmark) {
    const error = contentClients.size ? BENCHMARK_BOARD_ERROR : 'The Stockfish benchmark is already running.'
    report({ type: 'result', requestId, ok: false, error })
    return
  }
  const controller = new AbortController()
  const run = { requestId, controller, done: null }
  benchmark = run
  run.done = benchmarkStockfish(path, controller.signal).then(
    data => report({ type: 'result', requestId, ok: true, data }),
    error => report({ type: 'result', requestId, ok: false, error: error.message }),
  ).finally(() => { benchmark = null })
}

async function stopEngines(reason) {
  benchmark?.controller.abort(new Error(reason))
  await Promise.all([engine.kill(), benchmark?.done])
}

function report(event) {
  if (stopping) return
  const line = Buffer.from(JSON.stringify(event) + '\n')
  // Preserve overlay ordering: position-only updates depend on earlier draws.
  // Drop excess overlay work if the desktop stops consuming its pipe.
  const overlayBytes = event.type === 'overlay' ? line.length : 0
  if (pendingOverlayBytes + overlayBytes > MAX_PENDING_OVERLAY_BYTES) return
  pendingOverlayBytes += overlayBytes
  // A busy desktop only needs the newest snapshot. Keep the newest occurrence
  // in sequence with other pending events.
  const key = SNAPSHOT_REPORTS.has(event.type) ? event.type : Symbol()
  reports.delete(key)
  reports.set(key, { line, overlayBytes })
  flushReports()
}

function flushReports() {
  if (outputBlocked || !reports.size) return
  const [key, { line, overlayBytes }] = reports.entries().next().value
  reports.delete(key)
  pendingOverlayBytes -= overlayBytes
  outputBlocked = true

  // Bun's process.stdout.write can block on a full Windows pipe.
  // A serialized async fd write leaves the WebSocket loop free.
  function writeFrom(offset) {
    write(1, line, offset, line.length - offset, null, (error, count) => {
      if (error || count === 0) {
        void stop(1)
        return
      }
      const next = offset + count
      if (next < line.length) writeFrom(next)
      else {
        outputBlocked = false
        flushReports()
      }
    })
  }
  writeFrom(0)
}

function publish(message) {
  const data = JSON.stringify(message)
  for (const server of servers) server.publish(BROADCAST_TOPIC, data)
}

function updateStockfishStatus({ status, message }) {
  stockfishState = status
  publish({ type: 'engine_status', status, message })
}

const engine = new Engine(
  data => {
    publish({ type: 'eval', data })
    report({ type: 'eval', data })
  },
  data => {
    updateStockfishStatus(data)
    report({ type: 'engine-status', data })
  }
)

function isOlderExtensionVersion(current, available) {
  if (typeof current !== 'string' || !EXTENSION_VERSION.test(current)) return false
  const installed = current.split('.').map(Number)
  const bundled = available.split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    const difference = (bundled[i] ?? 0) - (installed[i] ?? 0)
    if (difference) return difference > 0
  }
  return false
}

function reportConnections() {
  const chessConnected = contentClients.size > 0
  report({
    type: 'component',
    data: {
      extensionConnected: chessConnected || presenceClients.size > 0,
      extensionUpdateAvailable: [...presenceClients.values()].some(Boolean),
      chessConnected,
      chessSite: [...contentClients.values()].at(-1) ?? null,
    },
  })
}

function setGameSettings(data) {
  gameSettings = data
  if (!data) return
  const message = JSON.stringify({ type: 'settings', data })
  for (const socket of contentClients.keys()) socket.sendText(message)
}

function identify(socket, message) {
  if (message.role === 'content') {
    benchmark?.controller.abort(new Error(BENCHMARK_BOARD_ERROR))
    contentClients.set(socket, typeof message.site === 'string' ? message.site : null)
    if (gameSettings) socket.sendText(JSON.stringify({ type: 'settings', data: gameSettings }))
  } else if (message.role === 'extension') {
    const browser = message.browser === 'firefox' ? 'firefox' : 'chromium'
    const version = versions[browser]
    const hasBundle = typeof version === 'string' && EXTENSION_VERSION.test(version)
    const older = hasBundle && isOlderExtensionVersion(message.version, version)
    // Older workers may not report an installed version.
    presenceClients.set(socket, hasBundle && (older || message.version == null))
    if (older) socket.sendText(JSON.stringify({ type: 'extension_update', version }))
  } else {
    return
  }
  reportConnections()
}

function validFen(fen) {
  // Network input must fit one UCI position line and describe a standard board.
  if (typeof fen !== 'string' || fen.length > 128 || /[^\x20-\x7e]/.test(fen)) return false
  const fields = fen.split(' ')
  const [placement, turn, castling, enPassant, halfmove, fullmove] = fields
  if ((fields.length !== 4 && fields.length !== 6) ||
      !FEN_PLACEMENT.test(placement) || (turn !== 'w' && turn !== 'b') ||
      !/^(?:-|[KQkqA-Ha-h]{1,8})$/.test(castling) || !/^(?:-|[a-h][36])$/.test(enPassant) ||
      (fields.length === 6 && (!/^\d{1,9}$/.test(halfmove) || !/^\d{1,9}$/.test(fullmove)))) return false
  if ((placement.match(/K/g) ?? []).length !== 1 || (placement.match(/k/g) ?? []).length !== 1) return false
  return placement.split('/').every(rank =>
    [...rank].reduce((width, square) => width + (Number(square) || 1), 0) === 8)
}

function validSearchSetting(value, max) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= max)
}

function reportMoveStatus(socket, data) {
  if (!contentClients.has(socket)) return
  if (data === null) {
    clearMoveStatus(socket)
    return
  }
  if (typeof data?.move !== 'string' || !UCI_MOVE.test(data.move) || !MOVE_STATES.has(data.state)) return
  moveStatusSource = socket
  report({ type: 'auto-move-status', data: { move: data.move, state: data.state } })
}

function clearMoveStatus(socket) {
  if (moveStatusSource !== socket) return
  moveStatusSource = undefined
  report({ type: 'auto-move-status', data: null })
}

function onMessage(socket, raw) {
  let message
  try { message = JSON.parse(raw) } catch { return }
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'get_status':
      socket.sendText(JSON.stringify({ type: 'app_status', stockfishState }))
      return
    case 'performance_ping':
      if (Number.isSafeInteger(message.id)) socket.sendText(JSON.stringify({ type: 'performance_pong', id: message.id }))
      return
    case 'identify':
      identify(socket, message)
      return
    case 'position':
      if (validFen(message.fen)) report({ type: 'position', data: { fen: message.fen, flipped: !!message.flipped } })
      return
    case 'auto_move_status':
      reportMoveStatus(socket, message.data)
      return
    case 'evaluate':
      if (validFen(message.fen) && validSearchSetting(message.depth, 30) && validSearchSetting(message.multiPv, 3)) {
        engine.evaluate(message.fen, message.depth, message.multiPv, message.force === true)
      }
      return
    case 'stop':
      engine.stop()
      return
    case 'new_game':
      clearMoveStatus(socket)
      engine.newGame()
      return
    // Older extensions may try to override desktop settings. Search depth
    // and MultiPV already travel with each evaluate request.
    case 'set_option':
    case 'ping':
    case 'pong':
      return
    default:
      if ('evalBar' in message || 'arrows' in message || 'positionOnly' in message || 'visible' in message) {
        report({ type: 'overlay', data: message })
      }
  }
}

function allowedOrigin(origin) {
  if (origin === null) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') &&
      !!url.hostname && !url.port && !url.username && !url.password &&
      (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash
  } catch {
    return false
  }
}

function listen(hostname, port) {
  return Bun.serve({
    hostname,
    port,
    development: false,
    fetch(request, server) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response(null, { status: 404 })
      }
      if (!allowedOrigin(request.headers.get('origin'))) return new Response(null, { status: 403 })
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      idleTimeout: 0,
      perMessageDeflate: false,
      maxPayloadLength: MAX_PAYLOAD,
      backpressureLimit: MAX_PAYLOAD,
      closeOnBackpressureLimit: true,
      open(socket) {
        socket.subscribe(BROADCAST_TOPIC)
      },
      message(socket, data) {
        if (typeof data !== 'string') {
          socket.close(1003, 'Text messages only')
          return
        }
        onMessage(socket, data)
      },
      close(socket) {
        const content = contentClients.delete(socket)
        const presence = presenceClients.delete(socket)
        if (stopping) return
        clearMoveStatus(socket)
        if (content && !contentClients.size) engine.stop()
        if (content || presence) reportConnections()
      },
    },
  })
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  clearInterval(heartbeat)
  input.close()
  process.stdin.pause()
  process.exitCode = code
  for (const server of servers) server.stop(true)
  try { await stopEngines('Chessist is shutting down.') } catch { process.exitCode = 1 }
}

process.stdin.on('error', () => stop(1))

input.on('line', (line) => {
  if (stopping) return
  let command
  try { command = JSON.parse(line) } catch { return }
  switch (command?.type) {
    case 'configure':
      versions = command.versions ?? {}
      setGameSettings(command.game)
      for (const [key, value] of Object.entries(command.engine ?? {})) engine.applySetting(key, value)
      if (command.stockfishState) {
        updateStockfishStatus({ status: command.stockfishState, message: command.stockfishMessage })
      }
      if (!servers.length) {
        try { start() } catch (error) {
          report({ type: 'fatal', message: error.message })
          void stop(1)
        }
      }
      break
    case 'engine-start':
      try { engine.start(command.path) } catch (error) {
        const data = { status: 'error', message: `Stockfish could not start: ${error.message}` }
        updateStockfishStatus(data)
        report({ type: 'engine-status', data })
      }
      break
    case 'engine-kill':
      stopEngines('Stockfish is restarting.').then(
        () => report({ type: 'result', requestId: command.requestId, ok: true }),
        error => report({ type: 'result', requestId: command.requestId, ok: false, error: error.message })
      )
      break
    case 'engine-setting':
      engine.applySetting(command.key, command.value)
      break
    case 'game-settings':
      setGameSettings(command.data)
      break
    case 'stockfish-status':
      updateStockfishStatus(command)
      break
    case 'performance-stockfish':
      runBenchmark(command)
      break
    case 'performance-cancel':
      if (benchmark?.requestId === command.requestId) {
        benchmark.controller.abort(new Error('The Stockfish benchmark was cancelled.'))
      }
      break
    case 'stop':
      void stop()
      break
  }
})
input.on('close', () => stop())

function start() {
  const portText = process.argv[2] ?? ''
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port > 65535) {
    throw new Error('Invalid local WebSocket port.')
  }
  // The extension connects explicitly to 127.0.0.1. IPv6 is optional.
  const server = listen('127.0.0.1', port)
  servers.push(server)
  try { servers.push(listen('::1', server.port)) } catch {}
  // The periodic application frame keeps Chromium's extension worker alive.
  heartbeat = setInterval(() => publish({ type: 'ping' }), 20000)
  report({ type: 'ready', port: server.port })
}
