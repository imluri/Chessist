import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../extension/src/content/lichess.js', import.meta.url), 'utf8')
const openingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const whiteMovedFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const blackMovedFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
const whiteTurnAgainFen = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'

const fixtureScript = source.replace(/\}\)\(\);\s*$/, `
  function prepareAutoMove(fen) {
    currentFen = fen;
    currentTurn = fen.split(' ')[1];
    lastGameId = getGameId();
    playerColor = detectPlayerColor();
    autoMove = true;
    instantMove = true;
    overlayMode = false;
    suppressInPage = true;
  }

  globalThis.roundHelpers = {
    getGameId, isInOwnGame, applyPushedSettings, prepareAutoMove, checkForPositionChange, observeBoard,
    startCountdown, executeScheduledMove: _executeMoveVerified,
    connectEngine: _connectEngineWs,
    primeAnalysisCache(fen) {
      _preWarmCache = { fenKey: _fenKey(fen), eval: { fen, depth: 18 } };
    },
    evaluateMove(fen, bestMove, fromCache) {
      prepareAutoMove(fen);
      updateEval({ fen, turn: currentTurn, depth: 11, bestMove, fromCache });
    },
  };
})();
`)

function squareStyle(file, row, color) {
  const x = color === 'black' ? 7 - file : file
  const y = color === 'black' ? 7 - row : row
  return { transform: `translate(${x * 100}px, ${y * 100}px)` }
}

function boardPieces(fen, color) {
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
  return fen.split(' ')[0].split('/').flatMap((rank, row) => {
    let file = 0
    const pieces = []
    for (const piece of rank) {
      if (/\d/.test(piece)) {
        file += Number(piece)
        continue
      }
      const pieceColor = piece === piece.toUpperCase() ? 'white' : 'black'
      const classList = [pieceColor, names[piece.toLowerCase()]]
      classList.contains = name => classList.includes(name)
      pieces.push({ classList, style: squareStyle(file, row, color) })
      file += 1
    }
    return pieces
  })
}

function loadRound(pathname, { participant = false, runningClock = false, boardInRound = true, color = 'white' } = {}) {
  const ignore = () => {}
  const selectors = new Set(participant ? ['.rcontrols .ricons'] : [])
  if (runningClock) selectors.add('.rclock-bottom.running')
  const relayMessages = []
  const localEvents = []
  const engineMessages = []
  let onEngineMessage
  const intervals = new Map()
  const observers = new Set()
  let intervalId = 0
  let now = 0
  const state = {
    pathname, color, fen: openingFen, boardPresent: true, relayResponse: { success: true },
    lastMove: [], hiddenLastMove: new Set(), moveTexts: [], hiddenSelectors: new Set(),
  }
  const match = (selector, predicate) => selector.split(',').some(part => predicate(part.trim()))
  const querySelector = selector => match(selector, part => selectors.has(part)) ? {} : null
  const makeBoard = () => ({
    classList: { contains: name => name === `orientation-${state.color}` },
    querySelector: selector => {
      if (selector === 'square.last-move' && state.lastMove.length) return {}
      return querySelector(selector)
    },
    querySelectorAll: selector => {
      if (selector === 'piece' && state.fen) return boardPieces(state.fen, state.color)
      if (selector === 'square.last-move') {
        return state.lastMove.map(square => ({ style: {
          ...squareStyle(square.charCodeAt(0) - 97, 8 - Number(square[1]), state.color),
          display: state.hiddenLastMove.has(square) ? 'none' : '',
        } }))
      }
      return selector.split(',').map(part => part.trim()).filter(part => selectors.has(part)).map(part => ({
        style: { display: state.hiddenSelectors.has(part) ? 'none' : '' },
      }))
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800 }),
    addEventListener: ignore,
    dispatchEvent: event => localEvents.push(event),
  })
  let board = makeBoard()
  const round = {
    contains: element => boardInRound && element === board,
    querySelector,
  }
  const element = (...classes) => ({
    nodeType: 1,
    matches: selector => match(selector, part =>
      part.startsWith('.') && part.slice(1).split('.').every(name => classes.includes(name))),
    querySelector: () => null,
  })
  const fixture = {
    window: { location: state, addEventListener: ignore },
    document: {
      readyState: 'loading',
      addEventListener: ignore,
      querySelector: selector => {
        if (match(selector, part => part === '.round__app')) return round
        if (match(selector, part => part === 'cg-wrap' || part === '.cg-wrap')) return state.boardPresent ? board : null
        if (selector === '[data-fen]' && state.pageFen) return { getAttribute: () => state.pageFen }
        return querySelector(selector)
      },
      querySelectorAll: selector => selector === 'i5d z7yx' ? state.moveTexts.map(textContent => ({ textContent })) : [],
      elementFromPoint: () => board,
    },
    chrome: {
      runtime: {
        connect: ({ name }) => ({
          onDisconnect: { addListener: ignore },
          onMessage: { addListener: listener => { if (name === 'engine') onEngineMessage = listener } },
          postMessage: ({ data }) => { if (name === 'engine') engineMessages.push(JSON.parse(data)) },
        }),
        onMessage: { addListener: ignore },
        sendMessage: async message => {
          if (message.type !== 'EXECUTE_MOVE') return
          relayMessages.push(message)
          if (state.relayResponse instanceof Error) throw state.relayResponse
          return state.relayResponse
        },
      },
      storage: {
        sync: { get: async () => ({ skillLevel: 14 }) },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    },
    WebSocket: { OPEN: 1 },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        this.targets = new Map()
      }
      observe(target, options) {
        this.targets.set(target, options)
        observers.add(this)
      }
      disconnect() {
        this.targets.clear()
        observers.delete(this)
      }
    },
    matchMedia: () => ({ addEventListener: ignore }),
    Date: { now: () => now },
    setInterval: callback => {
      intervals.set(++intervalId, callback)
      return intervalId
    },
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, delay = 0) => { if (delay < 100) queueMicrotask(callback) },
    clearTimeout: ignore,
    MouseEvent: class {},
    PointerEvent: class {},
  }
  runInNewContext(fixtureScript, fixture)
  intervals.clear()
  return {
    ...fixture.roundHelpers,
    state, selectors, relayMessages, localEvents, engineMessages,
    evaluateMove(fen, bestMove, { fromCache = false } = {}) {
      fixture.roundHelpers.evaluateMove(fen, bestMove, fromCache)
      return relayMessages.map(({ from, to }) => from + to)
    },
    async pollPosition() {
      fixture.roundHelpers.checkForPositionChange()
      await Promise.resolve()
    },
    async observeCurrentBoard() {
      fixture.roundHelpers.observeBoard(board)
      await Promise.resolve()
    },
    async mutateRound({ attributeClasses, removedClasses, addedClasses }) {
      const record = attributeClasses
        ? { type: 'attributes', attributeName: 'class', target: element(...attributeClasses) }
        : {
            type: 'childList', target: round,
            addedNodes: addedClasses ? [element(...addedClasses)] : [],
            removedNodes: removedClasses ? [element(...removedClasses)] : [],
          }
      for (const observer of observers) {
        const options = observer.targets.get(round)
        if (!options?.subtree || !options[record.type]) continue
        if (options.attributeFilter && record.type === 'attributes' &&
          !options.attributeFilter.includes(record.attributeName)) continue
        observer.callback([record])
      }
      await Promise.resolve()
    },
    async replaceBoard() {
      board = makeBoard()
      fixture.roundHelpers.observeBoard(board)
      await Promise.resolve()
    },
    async openEngine() {
      fixture.chrome.runtime.id = 'test-extension'
      fixture.roundHelpers.connectEngine()
      onEngineMessage({ kind: 'open' })
      await Promise.resolve()
      return engineMessages
    },
    closeEngine() {
      onEngineMessage({ kind: 'closed' })
    },
    sendEngineSettings(data) {
      onEngineMessage({ kind: 'frame', data: JSON.stringify({ type: 'settings', data }) })
    },
    sendEngineEvaluation(fen, bestMove) {
      const data = { fen, turn: fen.split(' ')[1], depth: 5, bestMove }
      onEngineMessage({ kind: 'frame', data: JSON.stringify({ type: 'eval', data }) })
    },
    advanceCountdown(ms) {
      now += ms
      for (const callback of intervals.values()) callback()
    },
  }
}

describe('Lichess round recognition', () => {
  it.each(['/game/aB3dEf56', '/game/aB3dEf56WXYZ', '/game/aB3dEf56/white', '/aB3dEf56', '/aB3dEf56WXYZ', '/aB3dEf56/black'])(
    'identifies the same game on supported route %s',
    pathname => expect(loadRound(pathname).getGameId()).toBe('aB3dEf56'),
  )

  it.each(['/analysis/standard', '/game/aB3dEf56/white/analysis', '/aB3dEf56/mini', '/game/aB3dEf56/continue/white', '/aB3dEf56W'])(
    'rejects a non-round route %s',
    pathname => expect(loadRound(pathname).getGameId()).toBeNull(),
  )

  it('recognizes the player on a computer opening board before the clocks start', () => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    expect(round.isInOwnGame()).toBe(true)
    expect(round.evaluateMove(openingFen, 'e2e4')).toEqual(['e2e4'])
  })

  it('ignores hidden last-move markers left on an opening board', () => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    round.state.lastMove = ['e2', 'e4']
    round.state.hiddenLastMove.add('e2')
    round.state.hiddenLastMove.add('e4')
    expect(round.evaluateMove(openingFen, 'e2e4')).toEqual(['e2e4'])
  })

  it('keeps a spectated round read-only even with a running clock and a manual color', () => {
    const round = loadRound('/game/aB3dEf56/white', { runningClock: true })
    round.applyPushedSettings({ playerColor: 'white' })
    expect(round.isInOwnGame()).toBe(false)
    expect(round.evaluateMove(openingFen, 'e2e4')).toEqual([])
  })

  it('requires the board to be inside the round with participant controls', () => {
    expect(loadRound('/game/aB3dEf56', { participant: true, boardInRound: false }).isInOwnGame()).toBe(false)
  })

  it('does not treat an analysis board as a player round', () => {
    expect(loadRound('/analysis').isInOwnGame()).toBe(false)
  })

  it('waits for desktop settings on each connection and sends no raw engine options', async () => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    round.state.fen = blackMovedFen
    round.prepareAutoMove(blackMovedFen)
    await round.openEngine()
    expect(round.engineMessages).toEqual([{ type: 'identify', role: 'content', site: 'Lichess' }])

    round.sendEngineSettings({ depth: 24, showAltArrows: false })
    const evaluations = () => round.engineMessages.filter(({ type }) => type === 'evaluate')
    expect(evaluations()).toEqual([{ type: 'evaluate', fen: blackMovedFen, depth: 24, multiPv: 1 }])

    round.closeEngine()
    await round.openEngine()
    expect(evaluations()).toHaveLength(1)
    round.sendEngineSettings({ depth: 26, showAltArrows: true })
    expect(evaluations()).toHaveLength(2)
    expect(evaluations().at(-1)).toEqual({ type: 'evaluate', fen: blackMovedFen, depth: 26, multiPv: 3 })
    expect(round.engineMessages.some(({ type }) => type === 'set_option')).toBe(false)
  })

  it.each([
    [{ depth: 24 }, 24, 1],
    [{ showAltArrows: true }, 18, 3],
  ])('discards a cached analysis after a desktop settings change (%j)', async (settings, depth, multiPv) => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    round.state.fen = blackMovedFen
    round.prepareAutoMove(blackMovedFen)
    await round.openEngine()
    round.sendEngineSettings({ depth: 18, showAltArrows: false })
    round.primeAnalysisCache(blackMovedFen)

    round.sendEngineSettings(settings)

    const evaluations = round.engineMessages.filter(({ type }) => type === 'evaluate')
    expect(evaluations).toHaveLength(2)
    expect(evaluations.at(-1)).toEqual({ type: 'evaluate', fen: blackMovedFen, depth, multiPv })
  })
})

describe('Lichess auto-move turn and dispatch safeguards', () => {
  const gameId = 'aB3dEf56'
  const move = 'g1f3'
  const position = blackMovedFen.split(' ').slice(0, 2).join(' ')

  function readyRound() {
    const round = loadRound(`/game/${gameId}`, { participant: true, runningClock: true })
    round.state.fen = blackMovedFen
    round.prepareAutoMove(blackMovedFen)
    return round
  }

  it.each([
    ['the opponent is running', '.rclock-top.running'],
    ['neither clock is running', '.rclock-top.emerg'],
  ])('ignores a low-time player clock when %s', (_, opponentClock) => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-bottom.emerg')
    round.selectors.add(opponentClock)
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])
  })

  it('allows Black’s first move when the clocks are stopped and White’s move is on the board', () => {
    const round = loadRound(`/game/${gameId}`, { participant: true, color: 'black' })
    round.state.fen = whiteMovedFen
    round.state.lastMove = ['e2', 'e4']
    round.state.moveTexts = ['e4', '…']
    expect(round.evaluateMove(whiteMovedFen, 'e7e5')).toEqual(['e7e5'])
  })

  it('recognizes the active turn in an untimed game', () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-bottom.rclock-turn .rclock-turn__text')
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([move])
  })

  it('ignores hidden premove markers left on the board', () => {
    const round = readyRound()
    round.selectors.add('square.current-premove')
    round.state.hiddenSelectors.add('square.current-premove')
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([move])
  })

  it('dispatches a delayed move once when the position and turn are still current', () => {
    const round = readyRound()
    round.startCountdown(100, position, move, gameId)
    round.advanceCountdown(100)
    expect(round.relayMessages).toEqual([expect.objectContaining({
      type: 'EXECUTE_MOVE', from: 'g1', to: 'f3', singleAttempt: true,
    })])
  })

  it.each([
    ['the opponent clock starts with the same piece placement', round => {
      round.selectors.delete('.rclock-bottom.running')
      round.selectors.add('.rclock-top.running')
    }],
    ['the board position changes', round => { round.state.fen = whiteMovedFen }],
    ['the game changes', round => { round.state.pathname = '/game/00000000' }],
    ['the board disappears', round => { round.state.boardPresent = false }],
    ['the board cannot be read', round => { round.state.fen = null }],
    ['a premove appears', round => { round.selectors.add('square.current-premove') }],
  ])('drops a scheduled move when %s', (_, change) => {
    const round = readyRound()
    round.startCountdown(100, position, move, gameId)
    change(round)
    round.advanceCountdown(100)
    expect(round.relayMessages).toEqual([])
    expect(round.localEvents).toEqual([])
  })

  it.each([
    { success: true },
    { success: false },
    new Error('Connection closed before the relay confirmed the result'),
  ])('never resends a move when the board has not confirmed the first attempt (%s)', async response => {
    const round = readyRound()
    round.state.relayResponse = response
    await round.executeScheduledMove(move, position, gameId)
    expect(round.relayMessages).toEqual([expect.objectContaining({ type: 'EXECUTE_MOVE' })])
    expect(round.localEvents).toEqual([])
  })

  it('keeps the execution lock when unchanged auto-move settings arrive', async () => {
    const round = readyRound()
    let finishRelay
    round.state.relayResponse = new Promise(resolve => { finishRelay = resolve })
    const first = round.executeScheduledMove(move, position, gameId)
    round.applyPushedSettings({ autoMove: true })
    const second = round.executeScheduledMove(move, position, gameId)
    finishRelay({ success: true })
    await Promise.all([first, second])
    expect(round.relayMessages).toHaveLength(1)
  })

  it('dispatches the ready evaluation when the clock settles without another evaluation', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-top.running')
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    await round.pollPosition()
    expect(round.relayMessages).toEqual([])

    round.selectors.delete('.rclock-top.running')
    round.selectors.add('.rclock-bottom.running')
    await round.pollPosition()
    expect(round.relayMessages).toEqual([expect.objectContaining({ from: 'g1', to: 'f3' })])
  })

  it('sends a queued instant move on the clock mutation without polling', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-top.running')
    await round.observeCurrentBoard()
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    round.selectors.add('.rclock-bottom.running')
    await round.mutateRound({ attributeClasses: ['rclock-bottom', 'running'] })
    expect(round.relayMessages).toEqual([])

    round.selectors.delete('.rclock-top.running')
    await round.mutateRound({ attributeClasses: ['unrelated'] })
    expect(round.relayMessages).toEqual([])

    await round.mutateRound({ attributeClasses: ['rclock-top'] })
    await round.mutateRound({ attributeClasses: ['rclock-bottom', 'running'] })
    expect(round.relayMessages).toEqual([expect.objectContaining({
      type: 'EXECUTE_MOVE', from: 'g1', to: 'f3', instant: true, singleAttempt: true,
    })])
  })

  it('rechecks an instant move when the untimed turn indicator is inserted', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-top.rclock-turn .rclock-turn__text')
    await round.observeCurrentBoard()
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    round.selectors.delete('.rclock-top.rclock-turn .rclock-turn__text')
    round.selectors.add('.rclock-bottom.rclock-turn .rclock-turn__text')
    await round.mutateRound({ removedClasses: ['rclock-turn__text'], addedClasses: ['rclock-turn__text'] })
    expect(round.relayMessages).toHaveLength(1)
  })

  it.each([
    ['a visible premove', round => { round.selectors.add('square.current-premove') }],
    ['another game', round => { round.state.pathname = '/game/00000000' }],
    ['a different position', round => { round.state.fen = whiteTurnAgainFen }],
  ])('withholds the queued instant move on a clock change with %s', async (_, change) => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    round.selectors.add('.rclock-top.running')
    await round.observeCurrentBoard()
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    change(round)
    round.selectors.delete('.rclock-top.running')
    round.selectors.add('.rclock-bottom.running')
    await round.mutateRound({ attributeClasses: ['rclock-bottom', 'running'] })
    expect(round.relayMessages).toEqual([])
  })

  it('retains the next position’s ready evaluation while a previous relay is in flight', async () => {
    const round = readyRound()
    let finishRelay
    round.state.relayResponse = new Promise(resolve => { finishRelay = resolve })
    const first = round.executeScheduledMove(move, position, gameId)

    round.state.fen = whiteTurnAgainFen
    expect(round.evaluateMove(whiteTurnAgainFen, 'f1c4')).toEqual([move])

    finishRelay({ success: true })
    await first
    await round.pollPosition()
    expect(round.relayMessages).toEqual([
      expect.objectContaining({ from: 'g1', to: 'f3' }),
      expect.objectContaining({ from: 'f1', to: 'c4' }),
    ])
  })

  it('discards an unsent evaluation when a different game opens on the same position', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    round.state.pathname = '/game/00000000'
    round.selectors.add('.rclock-bottom.running')
    await round.pollPosition()
    expect(round.relayMessages).toEqual([])
  })

  it('discards an unsent evaluation once the position changes', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([])

    round.state.fen = whiteTurnAgainFen
    round.selectors.add('.rclock-bottom.running')
    await round.pollPosition()
    round.state.fen = blackMovedFen
    await round.pollPosition()
    await round.pollPosition()
    expect(round.relayMessages).toEqual([])
  })

  it('does not reconsider a sent move after an ambiguous relay response', async () => {
    const round = readyRound()
    round.state.relayResponse = new Error('Connection closed before the relay confirmed the result')
    await round.executeScheduledMove(move, position, gameId)
    expect(round.evaluateMove(blackMovedFen, move)).toEqual([move])
    await round.pollPosition()
    expect(round.relayMessages).toHaveLength(1)
  })

  it('does not schedule a display-only prediction after the clock settles', async () => {
    const round = readyRound()
    round.selectors.delete('.rclock-bottom.running')
    expect(round.evaluateMove(blackMovedFen, move, { fromCache: true })).toEqual([])

    round.selectors.add('.rclock-bottom.running')
    await round.pollPosition()
    expect(round.relayMessages).toEqual([])
  })
})

describe('Lichess opening analysis', () => {
  function evaluationRequests(round) {
    return round.engineMessages.filter(({ type }) => type === 'evaluate')
  }

  it('requests and plays the opening once per round when Lichess reuses the same starting board', async () => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    round.applyPushedSettings({ autoMove: true, instantMove: true })
    await round.openEngine()
    round.sendEngineSettings({ autoMove: true, instantMove: true })
    await round.pollPosition()
    round.sendEngineEvaluation(openingFen, 'e2e4')
    await round.pollPosition()
    expect(evaluationRequests(round)).toEqual([expect.objectContaining({ fen: openingFen })])
    expect(round.relayMessages).toEqual([expect.objectContaining({ from: 'e2', to: 'e4' })])

    round.state.pathname = '/game/00000000'
    round.sendEngineEvaluation(openingFen, 'd2d4')
    expect(round.relayMessages).toHaveLength(1)
    await round.pollPosition()
    await round.pollPosition()
    expect(evaluationRequests(round)).toEqual([
      expect.objectContaining({ fen: openingFen }),
      expect.objectContaining({ fen: openingFen, force: true }),
    ])
    round.sendEngineEvaluation(openingFen, 'd2d4')
    expect(round.relayMessages).toEqual([
      expect.objectContaining({ from: 'e2', to: 'e4' }),
      expect.objectContaining({ from: 'd2', to: 'd4' }),
    ])
  })

  it('waits for the replacement board and detects a new player color as soon as the controls arrive', async () => {
    const round = loadRound('/game/aB3dEf56', { participant: true, color: 'black' })
    round.applyPushedSettings({ autoMove: true, instantMove: true })
    await round.openEngine()
    round.sendEngineSettings({ autoMove: true, instantMove: true })
    await round.pollPosition()
    round.sendEngineEvaluation(openingFen, 'e2e4')
    expect(round.relayMessages).toEqual([])

    round.state.pathname = '/game/00000000'
    round.state.fen = null
    round.state.color = 'white'
    round.state.pageFen = blackMovedFen
    round.selectors.delete('.rcontrols .ricons')
    await round.replaceBoard()
    expect(evaluationRequests(round)).toHaveLength(1)

    round.state.fen = openingFen
    await round.pollPosition()
    expect(evaluationRequests(round)).toHaveLength(2)
    expect(evaluationRequests(round).at(-1)).toMatchObject({ fen: openingFen })
    round.sendEngineEvaluation(openingFen, 'd2d4')
    expect(round.relayMessages).toEqual([])

    round.selectors.add('.rcontrols .ricons')
    await round.pollPosition()
    expect(evaluationRequests(round)).toHaveLength(2)
    expect(round.relayMessages).toEqual([expect.objectContaining({ from: 'd2', to: 'd4' })])
  })

  it('requests an existing opening when desktop settings enable analysis and auto-move', async () => {
    const round = loadRound('/game/aB3dEf56', { participant: true })
    round.applyPushedSettings({ enabled: false })
    await round.openEngine()
    round.sendEngineSettings({ enabled: false })
    await round.pollPosition()
    expect(evaluationRequests(round)).toEqual([])

    round.applyPushedSettings({ enabled: true, autoMove: true, instantMove: true })
    expect(evaluationRequests(round)).toEqual([expect.objectContaining({ fen: openingFen })])
    round.sendEngineEvaluation(openingFen, 'e2e4')
    expect(round.relayMessages).toEqual([expect.objectContaining({ from: 'e2', to: 'e4' })])
  })
})
