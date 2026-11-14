import { on, once } from 'node:events'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { Bridge } from './wsserver.js'

const extensionOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const status = { type: 'app_status', stockfishState: 'downloading' }

let bridge
let engineFixture
const sockets = new Set()

function createBridge(onComponent = vi.fn(), options = {}) {
  bridge = new Bridge(onComponent, { port: 0, ...options })
  return bridge
}

function connect(port, origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin })
  // Tests also deliberately connect with a disallowed Origin.
  socket.on('error', () => {})
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
  return socket
}

function opened(socket) {
  return once(socket, 'open', { signal: AbortSignal.timeout(3000) })
}

async function nextMessage(socket, type) {
  for await (const [data] of on(socket, 'message', { signal: AbortSignal.timeout(3000) })) {
    const message = JSON.parse(data.toString())
    if (message.type === type) return message
  }
}

function request(socket, message, responseType) {
  const response = nextMessage(socket, responseType)
  socket.send(JSON.stringify(message))
  return response
}

async function startWithUciFixture() {
  // The engine launches its binary without arguments. Preload a fake UCI
  // implementation into our existing Node executable to exercise the real
  // pipes without downloading Stockfish or compiling a fixture executable.
  engineFixture = await mkdtemp(join(tmpdir(), 'chessist-uci-'))
  const filename = join(engineFixture, 'fixture.cjs')
  await writeFile(filename, `
    if (!process.versions.bun && process.argv.length === 1) {
      const readline = require('node:readline')
      const input = readline.createInterface({ input: process.stdin })
      let skill = 20
      let multiPv = 1
      input.on('line', line => {
        if (line === 'uci') console.log('uciok')
        if (line === 'isready') console.log('readyok')
        if (line.startsWith('setoption name Skill Level value ')) skill = Number(line.split(' ').at(-1))
        if (line.startsWith('setoption name MultiPV value ')) multiPv = Number(line.split(' ').at(-1))
        if (line.startsWith('go depth ')) {
          const depth = line.split(' ').at(-1)
          console.log('info depth ' + depth + ' multipv 1 score cp ' + (skill * 10 + multiPv) + ' pv e2e4')
          console.log('bestmove e2e4')
        }
      })
    }
  `)
  const prior = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = `--require="${filename.replaceAll('\\', '/')}"`
  try {
    return await bridge.start()
  } finally {
    if (prior === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = prior
  }
}

afterEach(async () => {
  try {
    await bridge?.stop()
  } finally {
    for (const socket of sockets) socket.terminate()
    sockets.clear()
    bridge = null
    if (engineFixture) {
      await rm(join(engineFixture, 'fixture.cjs'), { force: true })
      await rmdir(engineFixture)
      engineFixture = null
    }
  }
})

it('handles the popup, position, overlay, and live settings protocol in Bun', async () => {
  const onComponent = vi.fn()
  const onPosition = vi.fn()
  const onOverlay = vi.fn()
  createBridge(onComponent, { game: { depth: 16 }, onPosition, onOverlay })
  const port = await bridge.start()
  expect(port).toBeGreaterThan(0)

  const content = connect(port, extensionOrigin)
  const popup = connect(port, extensionOrigin)
  await Promise.all([opened(content), opened(popup)])

  const updatedStatus = nextMessage(popup, 'engine_status')
  bridge.broadcastStatus({ status: 'downloading', message: 'Downloading Stockfish' })
  await expect(updatedStatus).resolves.toMatchObject({ status: 'downloading' })
  const workerOutput = []
  const record = data => workerOutput.push(data.toString())
  bridge.worker.child.stdout.on('data', record)
  await expect(request(popup, { type: 'get_status' }, 'app_status')).resolves.toEqual(status)
  bridge.worker.child.stdout.off('data', record)
  expect(workerOutput.join('')).not.toContain('get_status')
  await expect(request(content, {
    type: 'identify', role: 'content', site: 'Lichess',
  }, 'settings')).resolves.toEqual({ type: 'settings', data: { depth: 16 } })
  await vi.waitFor(() => expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({
    extensionConnected: true, chessConnected: true, chessSite: 'Lichess',
  })))

  content.send(JSON.stringify({ type: 'position', fen, flipped: true }))
  content.send(JSON.stringify({ positionOnly: true, visible: true }))
  await vi.waitFor(() => expect(onPosition).toHaveBeenCalledWith({ fen, flipped: true }))
  await vi.waitFor(() => expect(onOverlay).toHaveBeenCalledWith({ positionOnly: true, visible: true }))

  const updatedSettings = nextMessage(content, 'settings')
  const popupMessages = vi.fn()
  popup.on('message', popupMessages)
  bridge.broadcastSettings({ depth: 18 })
  await expect(updatedSettings).resolves.toEqual({ type: 'settings', data: { depth: 18 } })
  await request(popup, { type: 'get_status' }, 'app_status')
  expect(popupMessages.mock.calls.map(([data]) => JSON.parse(data.toString()).type)).toEqual(['app_status'])

  content.close()
  await vi.waitFor(() => expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({
    extensionConnected: false, chessConnected: false, chessSite: null,
  })))
}, 10000)

it.each([
  ['2.0.9', true, true],
  ['2.0.10', false, false],
  ['2.1.0', false, false],
  [undefined, true, false],
])('keeps the extension update handshake for Firefox version %s', async (version, needsUpdate, sendUpdate) => {
  const onComponent = vi.fn()
  createBridge(onComponent, { versions: { firefox: '2.0.10', chromium: '2.0.9' } })
  const port = await bridge.start()
  const presence = connect(port, 'moz-extension://a36e774c-35c0-4537-810f-d8f183c21487')
  await opened(presence)
  const received = vi.fn()
  presence.on('message', received)
  presence.send(JSON.stringify({ type: 'identify', role: 'extension', browser: 'firefox', version }))
  await request(presence, { type: 'get_status' }, 'app_status')

  await vi.waitFor(() => expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({
    extensionConnected: true, extensionUpdateAvailable: needsUpdate,
  })))
  const messages = received.mock.calls.map(([data]) => JSON.parse(data.toString()))
  const updates = messages.filter(({ type }) => type === 'extension_update')
  expect(updates).toEqual(sendUpdate ? [{ type: 'extension_update', version: '2.0.10' }] : [])
}, 10000)

it('runs Stockfish UCI in Bun, broadcasts evaluations, and applies Electron settings', async () => {
  const onEval = vi.fn()
  const onEngineStatus = vi.fn()
  createBridge(vi.fn(), { engine: { skillLevel: 8, threads: 1, hash: 128 }, onEval, onEngineStatus })
  const port = await startWithUciFixture()
  const content = connect(port, extensionOrigin)
  const presence = connect(port, extensionOrigin)
  await Promise.all([opened(content), opened(presence)])

  const ready = nextMessage(content, 'engine_status')
  bridge.startEngine(process.execPath)
  await expect(ready).resolves.toMatchObject({ type: 'engine_status', status: 'starting' })
  await vi.waitFor(() => expect(onEngineStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' })), { timeout: 3000 })
  await expect(request(content, { type: 'get_status' }, 'app_status')).resolves.toMatchObject({ stockfishState: 'ready' })

  content.send(JSON.stringify({ type: 'identify', role: 'content', site: 'Lichess' }))
  // Legacy extension writes must not change desktop-owned engine options.
  content.send(JSON.stringify({ type: 'set_option', name: 'Skill Level', value: '20' }))
  const evaluation = request(content, { type: 'evaluate', fen, depth: 16, multiPv: 3, force: true }, 'eval')
  const broadcast = nextMessage(presence, 'eval')
  await expect(evaluation).resolves.toMatchObject({ type: 'eval', data: { fen, depth: 16, cp: 83, bestMove: 'e2e4' } })
  await expect(broadcast).resolves.toMatchObject({ type: 'eval', data: { cp: 83 } })
  await vi.waitFor(() => expect(onEval).toHaveBeenCalledWith(expect.objectContaining({ fen, cp: 83 })))

  const refreshed = nextMessage(content, 'eval')
  bridge.applyEngineSetting('skillLevel', 12)
  await expect(refreshed).resolves.toMatchObject({ type: 'eval', data: { cp: 123 } })
  await bridge.killEngine()
}, 10000)

it('rejects ordinary web origins and shuts down active sockets', async () => {
  createBridge()
  const port = await bridge.start()
  const website = connect(port, 'https://example.test')
  await expect(opened(website)).rejects.toThrow(/Unexpected server response/)

  const localClient = connect(port)
  await opened(localClient)
  const closed = once(localClient, 'close', { signal: AbortSignal.timeout(3000) })
  await bridge.stop()
  await closed

  const replacement = connect(await bridge.start())
  await opened(replacement)
  await expect(request(replacement, { type: 'get_status' }, 'app_status')).resolves.toMatchObject({ type: 'app_status' })
}, 10000)

it('clears stale connection status and restores settings after the worker exits', async () => {
  const onComponent = vi.fn()
  createBridge(onComponent, { game: { depth: 16 } })
  const port = await bridge.start()
  const content = connect(port, extensionOrigin)
  await opened(content)
  const identify = { type: 'identify', role: 'content', site: 'Lichess' }
  await request(content, identify, 'settings')
  await vi.waitFor(() => expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({ chessConnected: true })))
  const updated = nextMessage(content, 'settings')
  bridge.broadcastSettings({ depth: 19 })
  await updated

  onComponent.mockClear()
  const stopped = once(content, 'close', { signal: AbortSignal.timeout(3000) })
  bridge.worker.child.kill()
  await stopped
  await vi.waitFor(() => expect(onComponent).toHaveBeenCalledWith(expect.objectContaining({
    extensionConnected: false, chessConnected: false,
  })))
  await vi.waitFor(() => expect(onComponent).toHaveBeenCalledWith(expect.objectContaining({
    wsError: expect.any(String),
  })))
  await vi.waitFor(() => expect(onComponent).toHaveBeenCalledWith({ wsError: null }), { timeout: 3000 })

  const replacement = connect(await bridge.start(), extensionOrigin)
  await opened(replacement)
  await expect(request(replacement, identify, 'settings')).resolves.toEqual({ type: 'settings', data: { depth: 19 } })
}, 10000)
