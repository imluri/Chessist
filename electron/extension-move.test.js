import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../extension/src/background/service-worker.js', import.meta.url), 'utf8')

function startWorker({ debuggerAvailable = true, failFirstRelease = false, waitForFrame = async () => [{ result: true }] } = {}) {
  let onMessage
  const pointerEvents = []
  const event = { addListener() {} }
  const runtime = {
    getManifest: () => ({ version: '2.0.7' }),
    onStartup: event,
    onInstalled: event,
    onConnect: event,
    onMessage: { addListener: listener => { onMessage = listener } },
  }
  const executeScript = vi.fn()
    .mockResolvedValueOnce([{ result: { viewportFrom: { x: 450, y: 650 }, viewportTo: { x: 450, y: 450 } } }])
    .mockImplementationOnce(debuggerAvailable ? waitForFrame : async () => [{ result: { ok: true } }])
    .mockResolvedValue([{ result: { ok: true } }])
  const debuggerApi = {
    getTargets: callback => callback([]),
    attach: (_target, _version, callback) => callback(),
    detach: (_target, callback) => callback(),
    sendCommand: (_target, method, params, callback) => {
      if (method === 'Input.dispatchMouseEvent') pointerEvents.push(params)
      if (failFirstRelease && params.type === 'mouseReleased') {
        failFirstRelease = false
        runtime.lastError = { message: 'Connection closed before confirming the input' }
      }
      callback()
      delete runtime.lastError
    },
  }
  runInNewContext(source, {
    chrome: { runtime, debugger: debuggerAvailable ? debuggerApi : undefined, scripting: { executeScript } },
    WebSocket: class {},
    setTimeout: queueMicrotask,
  })
  return {
    get inputEvents() { return pointerEvents.map(({ type }) => type) },
    pointerEvents,
    executeScript,
    move: options => new Promise(resolve => onMessage({
      type: 'EXECUTE_MOVE', from: 'e2', to: 'e4', moveMode: 'drag', instant: true, ...options,
    }, { tab: { id: 1, url: 'https://lichess.org/aB3dEf56' } }, resolve)),
  }
}

it('does not repeat single-attempt input after an ambiguous debugger error', async () => {
  const worker = startWorker({ failFirstRelease: true })
  await expect(worker.move({ singleAttempt: true })).resolves.toMatchObject({ success: false })
  expect(worker.inputEvents.filter(type => type === 'mousePressed')).toHaveLength(1)
  expect(worker.executeScript).toHaveBeenCalledTimes(2)
})

it('waits for the browser to process the drag before releasing at the destination', async () => {
  let finishFrame
  const worker = startWorker({
    waitForFrame: () => new Promise(resolve => { finishFrame = resolve }),
  })
  const response = worker.move({ singleAttempt: true })
  try {
    await vi.waitFor(() => expect(finishFrame).toBeTypeOf('function'))
    expect(worker.pointerEvents.at(-1)).toMatchObject({ type: 'mouseMoved', x: 450, y: 450, buttons: 1 })
    expect(worker.inputEvents).not.toContain('mouseReleased')
  } finally {
    finishFrame?.([{ result: true }])
  }
  await expect(response).resolves.toMatchObject({ success: true, executor: 'cdp-dom-input' })
  expect(worker.pointerEvents.filter(({ type }) => type === 'mouseReleased')).toEqual([
    expect.objectContaining({ x: 450, y: 450, buttons: 0 }),
  ])
})

it.each([
  ['does not render a frame', async () => [{ result: false }]],
  ['fails the frame check', async () => { throw new Error('Document unavailable') }],
])('releases at the source without a retry when the browser %s', async (_, waitForFrame) => {
  const worker = startWorker({ waitForFrame })
  await expect(worker.move({ singleAttempt: true })).resolves.toMatchObject({ success: false })
  expect(worker.inputEvents.filter(type => type === 'mousePressed')).toHaveLength(1)
  expect(worker.pointerEvents.filter(({ type }) => type === 'mouseReleased')).toEqual([
    expect.objectContaining({ x: 450, y: 650, buttons: 0 }),
  ])
  expect(worker.executeScript).toHaveBeenCalledTimes(2)
})

it('can use DOM input if the debugger is unavailable before any single-attempt input', async () => {
  const worker = startWorker({ debuggerAvailable: false })
  await expect(worker.move({ singleAttempt: true })).resolves.toMatchObject({
    success: true, executor: 'main-world-dom-input',
  })
  expect(worker.inputEvents).toEqual([])
  expect(worker.executeScript).toHaveBeenCalledTimes(2)
})

it('retains the debugger retry for callers using the existing relay options', async () => {
  const worker = startWorker({ failFirstRelease: true })
  await expect(worker.move()).resolves.toMatchObject({ success: true, executor: 'cdp-dom-input' })
  expect(worker.inputEvents.filter(type => type === 'mousePressed')).toHaveLength(2)
  expect(worker.executeScript).toHaveBeenCalledOnce()
})
