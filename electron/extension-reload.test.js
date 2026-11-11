import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../extension/src/background/service-worker.js', import.meta.url), 'utf8')

function startWorker(diskVersion, storage = {}) {
  let socket
  class TestSocket {
    constructor() { socket = this }
  }
  const event = { addListener() {} }
  const reload = vi.fn()
  runInNewContext(source, {
    chrome: {
      runtime: {
        getManifest: () => ({ version: '2.0.5' }),
        getURL: file => `chrome-extension://test/${file}`,
        reload,
        onStartup: event,
        onInstalled: event,
        onConnect: event,
        onMessage: event,
      },
      storage: { local: {
        get: async key => ({ [key]: storage[key] }),
        set: async values => { Object.assign(storage, values) },
      } },
      alarms: { create() {}, onAlarm: event },
    },
    fetch: async () => ({ ok: true, json: async () => ({ version: diskVersion }) }),
    WebSocket: TestSocket,
  })
  return {
    reload,
    update: version => socket.onmessage({ data: JSON.stringify({ type: 'extension_update', version }) }),
  }
}

it('keeps an unpacked copy running when its folder has not been updated', async () => {
  const worker = startWorker('2.0.5')
  await worker.update('2.0.6')
  expect(worker.reload).not.toHaveBeenCalled()
})

it('attempts a verified update once across repeated messages and worker restarts', async () => {
  const storage = {}
  const worker = startWorker('2.0.5.1', storage)
  await Promise.all([worker.update('2.0.5.1'), worker.update('2.0.5.1')])
  expect(worker.reload).toHaveBeenCalledOnce()

  const restarted = startWorker('2.0.5.1', storage)
  await restarted.update('2.0.5.1')
  expect(restarted.reload).not.toHaveBeenCalled()
})
