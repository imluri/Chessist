import { describe, expect, it, vi } from 'vitest'
import { Bridge } from './wsserver.js'

function identifyExtension(bridge, data) {
  const socket = { send: vi.fn() }
  bridge._onMessage(socket, JSON.stringify({ type: 'identify', role: 'extension', ...data }))
  return socket
}

it('ignores legacy option writes while passing the search settings from a connected tab', () => {
  const engine = { evaluate: vi.fn(), setOption: vi.fn() }
  const bridge = new Bridge(engine, null)
  const socket = { send: vi.fn() }
  const fen = '8/8/8/8/8/8/8/K6k w - - 0 1'
  const receive = message => bridge._onMessage(socket, JSON.stringify(message))

  receive({ type: 'identify', role: 'content', site: 'Lichess' })
  receive({ type: 'set_option', name: 'Skill Level', value: '20' })
  receive({ type: 'set_option', name: 'MultiPV', value: '3' })
  receive({ type: 'evaluate', fen, depth: 16, multiPv: 1 })

  expect(engine.setOption).not.toHaveBeenCalled()
  expect(engine.evaluate).toHaveBeenCalledWith(fen, 16, 1, false)
})

describe('browser extension update handshake', () => {
  it('offers the newer bundled version for the browser that connected', () => {
    const onComponent = vi.fn()
    const bridge = new Bridge(null, null, onComponent)
    bridge.getBundledExtensionVersion = (browser) => browser === 'firefox' ? '2.0.10' : '2.0.9'

    const socket = identifyExtension(bridge, { browser: 'firefox', version: '2.0.9' })

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'extension_update', version: '2.0.10' }))
    expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({ extensionConnected: true, extensionUpdateAvailable: true }))
  })

  it.each(['2.0.9', '2.0.10'])('does not request a reload of a current or newer worker (%s)', (version) => {
    const onComponent = vi.fn()
    const bridge = new Bridge(null, null, onComponent)
    bridge.getBundledExtensionVersion = () => '2.0.9'

    const socket = identifyExtension(bridge, { browser: 'chromium', version })

    expect(socket.send).not.toHaveBeenCalled()
    expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({ extensionConnected: true, extensionUpdateAvailable: false }))
  })

  it('shows a setup hint without sending an update message to a legacy worker', () => {
    const onComponent = vi.fn()
    const bridge = new Bridge(null, null, onComponent)
    bridge.getBundledExtensionVersion = () => '2.0.9'

    const socket = identifyExtension(bridge)

    expect(socket.send).not.toHaveBeenCalled()
    expect(onComponent).toHaveBeenLastCalledWith(expect.objectContaining({ extensionConnected: true, extensionUpdateAvailable: true }))
  })
})
