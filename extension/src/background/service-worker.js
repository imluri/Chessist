// Chessist - Service Worker (v2)
// The desktop app owns the engine. This worker keeps content scripts alive,
// executes auto-moves, and holds a presence connection to the desktop app so the
// app detects the extension on ANY page (not just chess.com / lichess.org).

// ── Presence connection to the desktop app ─────────────────────────────────────
// The content scripts only run on chess sites, so they can't signal presence
// everywhere. The service worker connects to the app's WebSocket and identifies,
// so the app shows "extension connected" regardless of which tab is open.
const APP_WS_URL = 'ws://127.0.0.1:27301'
const manifest = chrome.runtime.getManifest()
const extensionBrowser = manifest.browser_specific_settings?.gecko ? 'firefox' : 'chromium'
const RELOAD_TARGET_KEY = 'desktopExtensionReloadTarget'
let _swWs = null
let _swReconnect = null
let checkingExtensionUpdate = false

function isNewerExtensionVersion(version) {
  if (typeof version !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version)) return false
  const current = manifest.version.split('.').map(Number)
  const target = version.split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    const difference = (target[i] ?? 0) - (current[i] ?? 0)
    if (difference) return difference > 0
  }
  return false
}

async function reloadBundledUpdate(version) {
  if (checkingExtensionUpdate || !isNewerExtensionVersion(version)) return
  checkingExtensionUpdate = true
  try {
    const saved = await chrome.storage.local.get(RELOAD_TARGET_KEY)
    if (saved[RELOAD_TARGET_KEY] === version) return

    // The running manifest describes the loaded version. Read the extension's
    // own folder to confirm the installer actually replaced its files.
    const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
    if (!response.ok || (await response.json()).version !== version) return

    // Keep the marker across worker restarts so a failed reload cannot loop.
    await chrome.storage.local.set({ [RELOAD_TARGET_KEY]: version })
    chrome.runtime.reload()
  } catch (_) {
    // The desktop Setup page can still guide the user through a manual reload.
  } finally {
    checkingExtensionUpdate = false
  }
}

function connectPresence() {
  // Already connecting/open?
  if (_swWs && (_swWs.readyState === 0 || _swWs.readyState === 1)) return
  try {
    _swWs = new WebSocket(APP_WS_URL)
    _swWs.onopen = () => {
      try {
        _swWs.send(JSON.stringify({ type: 'identify', role: 'extension', browser: extensionBrowser, version: manifest.version }))
      } catch (e) {}
    }
    // Incoming messages (heartbeat pings, eval broadcasts) keep the MV3 worker alive.
    _swWs.onmessage = (event) => {
      let message
      try { message = JSON.parse(event.data) } catch (_) { return }
      if (message?.type === 'extension_update') return reloadBundledUpdate(message.version)
    }
    _swWs.onclose = () => { _swWs = null; scheduleReconnect() }
    _swWs.onerror = () => { try { _swWs.close() } catch (e) {} }
  } catch (e) {
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (_swReconnect) return
  _swReconnect = setTimeout(() => { _swReconnect = null; connectPresence() }, 3000)
}

// Connect on every worker wake-up.
chrome.runtime.onStartup.addListener(connectPresence)
chrome.runtime.onInstalled.addListener(connectPresence)

// Backup wake: an alarm revives the worker periodically and reconnects if needed.
try {
  chrome.alarms.create('chessist-presence', { periodInMinutes: 0.5 })
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'chessist-presence') connectPresence() })
} catch (e) {}

// Also connect when this worker script first loads.
connectPresence()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'content-alive') return
  // keep-alive only
})

// ── Engine relay ───────────────────────────────────────────────────────────────
// Content scripts can't open a loopback WebSocket from a public HTTPS page —
// Chrome blocks page-context connections to 127.0.0.1 (Private/Local Network
// Access + page CSP). The service worker runs in the extension context, which is
// exempt, so each content script opens a runtime port here and we own the real
// socket to the desktop app, relaying frames 1:1. From the app's point of view
// this is just a normal "content" connection, so the desktop side is unchanged.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'engine') return

  let sock
  try { sock = new WebSocket(APP_WS_URL) }
  catch (e) { try { port.postMessage({ kind: 'closed' }) } catch (_) {} ; return }

  sock.onopen = () => { try { port.postMessage({ kind: 'open' }) } catch (e) {} }
  sock.onmessage = (e) => { try { port.postMessage({ kind: 'frame', data: e.data }) } catch (err) {} }
  sock.onclose = () => { try { port.postMessage({ kind: 'closed' }) } catch (e) {} }
  sock.onerror = () => { try { sock.close() } catch (e) {} }

  port.onMessage.addListener((m) => {
    if (m && m.kind === 'frame' && sock && sock.readyState === 1) {
      try { sock.send(m.data) } catch (e) {}
    }
  })
  port.onDisconnect.addListener(() => {
    try { if (sock && sock.readyState <= 1) sock.close() } catch (e) {}
  })
})

const cdpPause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const debuggerTabs = new Set()

function debuggerAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}

function debuggerDetach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach({ tabId }, () => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}

function debuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(result)
    })
  })
}

function debuggerTargets() {
  return new Promise(resolve => chrome.debugger.getTargets(resolve))
}

chrome.debugger?.onDetach?.addListener(source => {
  if (source.tabId) debuggerTabs.delete(source.tabId)
})

async function ensureDebugger(tabId) {
  if (debuggerTabs.has(tabId)) return

  // A Manifest V3 worker can restart while the extension still owns the
  // debugger attachment. Probe that existing session before attaching again.
  const targets = await debuggerTargets().catch(() => [])
  if (targets.some(target => target.tabId === tabId && target.attached)) {
    try {
      await debuggerCommand(tabId, 'Runtime.evaluate', { expression: '1', returnByValue: true })
      debuggerTabs.add(tabId)
      return
    } catch (_) {}
  }

  await debuggerAttach(tabId)
  debuggerTabs.add(tabId)
}

async function cdpMouse(tabId, type, point, extra = {}) {
  await debuggerCommand(tabId, 'Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    pointerType: 'mouse',
    ...extra,
  })
}

async function cdpClick(tabId, point, instant = false) {
  await cdpMouse(tabId, 'mouseMoved', point)
  // Chessground ignores unrealistically compressed press/release sequences on
  // some frames.  These short gaps mirror a real click without delaying play.
  await cdpPause(instant ? 2 : 10)
  await cdpMouse(tabId, 'mousePressed', point, { button: 'left', buttons: 1, clickCount: 1 })
  await cdpPause(instant ? 8 : 35)
  await cdpMouse(tabId, 'mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 })
  await cdpPause(instant ? 4 : 35)
}

async function waitForRenderedDrag(tabId, destination) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: ({ x, y }) => new Promise(resolve => {
      const wrap = document.querySelector('cg-wrap') || document.querySelector('.cg-wrap')
      const board = wrap?.querySelector('cg-board') || wrap
      const piece = board?.querySelector('piece.dragging')
      if (!piece || document.hidden) { resolve(false); return }

      function checkDrag() {
        if (!board.isConnected || !piece.isConnected || !piece.classList.contains('dragging') || document.hidden) {
          finish(false)
          return
        }
        const { left, top, width, height } = piece.getBoundingClientRect()
        if (width > 0 && height > 0 && Math.abs(left + width / 2 - x) < width / 4 &&
            Math.abs(top + height / 2 - y) < height / 4) {
          finish(true)
          return
        }
        frame = requestAnimationFrame(checkDrag)
      }

      function finish(ready) {
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        resolve(ready)
      }

      let frame = requestAnimationFrame(checkDrag)
      const timeout = setTimeout(() => finish(false), 200)
    }),
    args: [destination],
  })
  return result?.[0]?.result === true
}

async function cdpBoardMove(tabId, from, to, mode, instant = false, waitForFrame = false) {
  try {
    if (mode === 'click') {
      await cdpClick(tabId, from, instant)
      // Lichess click-to-move needs enough time to select the source square
      // before the destination click arrives.
      await cdpPause(instant ? 16 : 80)
      await cdpClick(tabId, to, instant)
    } else {
      await cdpMouse(tabId, 'mouseMoved', from)
      await cdpMouse(tabId, 'mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 })
      await cdpPause(instant ? 4 : 12)
      await cdpMouse(tabId, 'mouseMoved', {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
      }, { button: 'left', buttons: 1 })
      await cdpMouse(tabId, 'mouseMoved', to, { button: 'left', buttons: 1 })
      if (waitForFrame) {
        // Chessground starts a new drag on an animation frame after the pointer moves.
        const dragReady = await waitForRenderedDrag(tabId, to).catch(() => false)
        if (!dragReady) {
          await cdpMouse(tabId, 'mouseReleased', from, { button: 'left', buttons: 0, clickCount: 1 })
          throw new Error('The browser did not render the drag in time')
        }
      } else {
        await cdpPause(instant ? 4 : 12)
      }
      await cdpMouse(tabId, 'mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 })
    }
  } catch (error) {
    try { await debuggerCommand(tabId, 'Input.cancelDragging') } catch (_) {}
    throw error
  }
}

async function executeCdpMove(tabId, from, to, mode, instant = false, onInputStart) {
  if (!chrome.debugger?.attach) throw new Error('Browser debugger API unavailable')
  let firstError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    let inputStarted = false
    try {
      await ensureDebugger(tabId)
      inputStarted = true
      onInputStart?.()
      await cdpBoardMove(tabId, from, to, mode, instant, instant && Boolean(onInputStart))
      return
    } catch (error) {
      if (!firstError) firstError = error
      debuggerTabs.delete(tabId)
      try { await debuggerDetach(tabId) } catch (_) {}
      if (inputStarted && onInputStart) throw error
    }
  }
  throw firstError || new Error('CDP input unavailable')
}

// Browser-only fallback. Events are created in the page's MAIN world and are
// delivered directly to Chessground; the Windows cursor is never touched.
async function domBoardMove(tabId, fromSquare, toSquare, mode, promotion, instant = false) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (from, to, moveMode, promoteTo, fast) => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
      const files = 'abcdefgh'
      const wrap = document.querySelector('cg-wrap') || document.querySelector('.cg-wrap')
      const chessCom = document.querySelector('wc-chess-board') || document.querySelector('chess-board')
      const board = wrap
        ? (wrap.querySelector('cg-board') || wrap)
        : (chessCom?.querySelector('.board') || chessCom?.shadowRoot?.querySelector('.board') || chessCom)
      if (!board) return { ok: false, error: 'DOM board unavailable' }

      const flipped = wrap
        ? wrap.classList.contains('orientation-black')
        : (chessCom.classList.contains('flipped') || chessCom.getAttribute('board-orientation') === 'black')
      const rect = board.getBoundingClientRect()
      if (!rect.width || !rect.height) return { ok: false, error: 'DOM board has no size' }
      const size = rect.width / 8
      const pointFor = (square) => {
        const file = files.indexOf(square[0])
        const rank = parseInt(square[1], 10) - 1
        return {
          x: flipped ? rect.left + (7 - file + 0.5) * size : rect.left + (file + 0.5) * size,
          y: flipped ? rect.top + (rank + 0.5) * size : rect.top + (7 - rank + 0.5) * size,
        }
      }
      const fromPoint = pointFor(from)
      const toPoint = pointFor(to)
      const targetAt = (point) => document.elementFromPoint(point.x, point.y) || board
      const eventOptions = (point, buttons, extra = {}) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons,
        ...extra,
      })
      const emitMove = (point, buttons = 0) => {
        const target = targetAt(point)
        target.dispatchEvent(new PointerEvent('pointermove', eventOptions(point, buttons, {
          pointerId: 1, pointerType: 'mouse', isPrimary: true,
        })))
        target.dispatchEvent(new MouseEvent('mousemove', eventOptions(point, buttons)))
      }
      const emitDown = (point) => {
        const target = targetAt(point)
        target.dispatchEvent(new PointerEvent('pointerdown', eventOptions(point, 1, {
          pointerId: 1, pointerType: 'mouse', isPrimary: true,
        })))
        target.dispatchEvent(new MouseEvent('mousedown', eventOptions(point, 1)))
      }
      const emitUp = (point, withClick) => {
        const target = targetAt(point)
        target.dispatchEvent(new PointerEvent('pointerup', eventOptions(point, 0, {
          pointerId: 1, pointerType: 'mouse', isPrimary: true,
        })))
        target.dispatchEvent(new MouseEvent('mouseup', eventOptions(point, 0)))
        if (withClick) target.dispatchEvent(new MouseEvent('click', eventOptions(point, 0, { detail: 1 })))
      }
      const clickPoint = async (point) => {
        emitMove(point)
        await sleep(fast ? 2 : 8)
        emitDown(point)
        await sleep(fast ? 8 : 25)
        emitUp(point, true)
        await sleep(fast ? 4 : 25)
      }

      if (moveMode === 'drag') {
        emitMove(fromPoint)
        await sleep(fast ? 2 : 8)
        emitDown(fromPoint)
        await sleep(fast ? 4 : 16)
        emitMove({ x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 }, 1)
        emitMove(toPoint, 1)
        await sleep(fast ? 4 : 16)
        emitUp(toPoint, false)
      } else {
        await clickPoint(fromPoint)
        await sleep(fast ? 16 : 60)
        await clickPoint(toPoint)
      }

      if (promoteTo) {
        // Lichess renders <div id="promotion-choice"><square><piece
        // class="queen ...">...</piece></square>...</div>. Wait for that
        // asynchronous redraw and click the square containing the requested
        // piece. The queen square is also exactly the pawn's destination.
        const names = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }
        const name = names[promoteTo] || 'queen'
        let choice = null
        for (let attempt = 0; attempt < 30 && !choice; attempt++) {
          const menu = document.querySelector('#promotion-choice, .promotion-choice')
          if (menu) {
            choice = [...menu.querySelectorAll('square')]
              .find(square => square.querySelector(`piece.${name}`)) || null
            if (!choice && promoteTo === 'q') choice = targetAt(toPoint)
          }
          if (!choice) await sleep(fast ? 10 : 20)
        }
        if (choice) choice.click()
      }
      return { ok: true }
    },
    args: [fromSquare, toSquare, mode || 'click', promotion || null, instant === true]
  })
  const result = results?.find(item => item.result)?.result
  if (!result?.ok) throw new Error(result?.error || 'MAIN-world DOM input failed')
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXECUTE_MOVE') return false
  const tabId = sender.tab?.id
  if (!tabId) { sendResponse({ success: false, error: 'No tabId' }); return true }

  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (from, to) => {
      const files = 'abcdefgh'
      const wrap = document.querySelector('cg-wrap') || document.querySelector('.cg-wrap')
      const chessCom = document.querySelector('wc-chess-board') || document.querySelector('chess-board')
      const board = wrap
        ? (wrap.querySelector('cg-board') || wrap)
        : (chessCom?.querySelector('.board') || chessCom?.shadowRoot?.querySelector('.board') || chessCom)
      if (!board) return null
      const flipped = wrap
        ? wrap.classList.contains('orientation-black')
        : (chessCom.classList.contains('flipped') || chessCom.getAttribute('board-orientation') === 'black')
      const rect = board.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      const size = rect.width / 8
      const square = (sq) => {
        const file = files.indexOf(sq[0]), rank = parseInt(sq[1], 10) - 1
        return {
          x: flipped ? rect.left + (7 - file + 0.5) * size : rect.left + (file + 0.5) * size,
          y: flipped ? rect.top + (rank + 0.5) * size : rect.top + (7 - rank + 0.5) * size
        }
      }
      const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2)
      const borderTop = Math.max(0, window.outerHeight - window.innerHeight - borderX)
      const relative = (p) => ({ x: borderX + p.x, y: borderTop + p.y })
      const viewportFrom = square(from)
      const viewportTo = square(to)
      return {
        from: relative(viewportFrom),
        to: relative(viewportTo),
        viewportFrom,
        viewportTo,
        window: { outerWidth: window.outerWidth, outerHeight: window.outerHeight }
      }
    },
    args: [message.from, message.to]
  }).then(async results => {
    const coordinates = results?.find(result => result.result)?.result
    if (!coordinates) throw new Error('DOM board coordinates unavailable')
    let executor = 'cdp-dom-input'
    let cdpError = null
    let inputStarted = false
    const onInputStart = message.singleAttempt ? () => { inputStarted = true } : undefined
    try {
      await executeCdpMove(
        tabId,
        coordinates.viewportFrom,
        coordinates.viewportTo,
        message.moveMode || 'click',
        message.instant === true,
        onInputStart
      )
    } catch (error) {
      // An input error can occur after a click or drag reached the board.
      if (inputStarted) throw error
      cdpError = error.message || String(error)
      await domBoardMove(
        tabId,
        message.from,
        message.to,
        message.moveMode || 'click',
        message.promotion || null,
        message.instant === true
      )
      executor = 'main-world-dom-input'
    }

    if (message.promotion && executor === 'cdp-dom-input') {
        await cdpPause(message.instant === true ? 12 : 50)
        const promotionResults = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: async (promotion, destination) => {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
            const names = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }
            const name = names[promotion] || 'queen'
            for (let attempt = 0; attempt < 30; attempt++) {
              const menu = document.querySelector('#promotion-choice, .promotion-choice')
              if (menu) {
                const square = [...menu.querySelectorAll('square')]
                  .find(candidate => candidate.querySelector(`piece.${name}`))
                if (square) {
                  const rect = square.getBoundingClientRect()
                  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                }
                // On every standard Lichess board the queen option occupies
                // the destination square. This also covers a changed menu DOM.
                if (promotion === 'q') return destination
              }
              await sleep(15)
            }
            return null
          }, args: [message.promotion, coordinates.viewportTo]
        })
        const promotionPoint = promotionResults?.find(item => item.result)?.result
        if (promotionPoint) {
          await cdpClick(tabId, promotionPoint, message.instant === true)
          await cdpPause(message.instant === true ? 25 : 70)

          // If Lichess did not consume the first selection, click the exact
          // option once more. This check prevents blind duplicate clicks after
          // the menu has already disappeared.
          const retryResults = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: (promotion, destination) => {
              const menu = document.querySelector('#promotion-choice, .promotion-choice')
              if (!menu) return null
              const names = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }
              const name = names[promotion] || 'queen'
              const square = [...menu.querySelectorAll('square')]
                .find(candidate => candidate.querySelector(`piece.${name}`))
              if (!square) return promotion === 'q' ? destination : null
              const rect = square.getBoundingClientRect()
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            }, args: [message.promotion, coordinates.viewportTo]
          })
          const retryPoint = retryResults?.find(item => item.result)?.result
          if (retryPoint) await cdpClick(tabId, retryPoint, message.instant === true)
        }
      }
    sendResponse({ success: true, executor, cdpError })
  }).catch(error => sendResponse({ success: false, error: error.message || String(error) }))
  return true
})
