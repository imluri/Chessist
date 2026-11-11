import { describe, expect, it, vi } from 'vitest'
import { Bridge } from './wsserver.js'

function identifyExtension(bridge, data) {
  const socket = { send: vi.fn() }
  bridge._onMessage(socket, JSON.stringify({ type: 'identify', role: 'extension', ...data }))
  return socket
}

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
