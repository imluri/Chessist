import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../extension/src/content/lichess.js', import.meta.url), 'utf8')
const openingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const whiteMovedFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const blackMovedFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

const fixtureScript = source.replace(/\}\)\(\);\s*$/, `
  function prepareAutoMove(fen) {
    currentFen = fen;
    currentTurn = fen.split(' ')[1];
    playerColor = detectPlayerColor();
    autoMove = true;
    instantMove = true;
    overlayMode = false;
    suppressInPage = true;
  }

  globalThis.roundHelpers = {
    getGameId, isInOwnGame, applyPushedSettings, prepareAutoMove,
    startCountdown, executeScheduledMove: _executeMoveVerified,
    evaluateMove(fen, bestMove) {
      prepareAutoMove(fen);
      updateEval({ fen, turn: currentTurn, depth: 11, bestMove });
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
  const intervals = new Map()
  let intervalId = 0
  let now = 0
  const state = {
    pathname, fen: openingFen, boardPresent: true, relayResponse: { success: true },
    lastMove: [], moveTexts: [],
  }
  const match = (selector, predicate) => selector.split(',').some(part => predicate(part.trim()))
  const querySelector = selector => match(selector, part => selectors.has(part)) ? {} : null
  const board = {
    classList: { contains: name => name === `orientation-${color}` },
    querySelector: selector => {
      if (selector === 'square.last-move' && state.lastMove.length) return {}
      return querySelector(selector)
    },
    querySelectorAll: selector => {
      if (selector === 'piece' && state.fen) return boardPieces(state.fen, color)
      if (selector === 'square.last-move') {
        return state.lastMove.map(square => ({ style: squareStyle(square.charCodeAt(0) - 97, 8 - Number(square[1]), color) }))
      }
      return []
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800 }),
    dispatchEvent: event => localEvents.push(event),
  }
  const round = {
    contains: element => boardInRound && element === board,
    querySelector,
  }
  const fixture = {
    window: { location: state, addEventListener: ignore },
    document: {
      readyState: 'loading',
      addEventListener: ignore,
      querySelector: selector => {
        if (match(selector, part => part === '.round__app')) return round
        if (match(selector, part => part === 'cg-wrap' || part === '.cg-wrap')) return state.boardPresent ? board : null
        return querySelector(selector)
      },
      querySelectorAll: selector => selector === 'i5d z7yx' ? state.moveTexts.map(textContent => ({ textContent })) : [],
      elementFromPoint: () => board,
    },
    chrome: {
      runtime: {
        connect: () => ({ onDisconnect: { addListener: ignore } }),
        onMessage: { addListener: ignore },
        sendMessage: async message => {
          relayMessages.push(message)
          if (state.relayResponse instanceof Error) throw state.relayResponse
          return state.relayResponse
        },
      },
    },
    matchMedia: () => ({ addEventListener: ignore }),
    Date: { now: () => now },
    setInterval: callback => {
      intervals.set(++intervalId, callback)
      return intervalId
    },
    clearInterval: id => intervals.delete(id),
    setTimeout: queueMicrotask,
    clearTimeout: ignore,
    MouseEvent: class {},
    PointerEvent: class {},
  }
  runInNewContext(fixtureScript, fixture)
  intervals.clear()
  return {
    ...fixture.roundHelpers,
    state, selectors, relayMessages, localEvents,
    evaluateMove(fen, bestMove) {
      fixture.roundHelpers.evaluateMove(fen, bestMove)
      return relayMessages.map(({ from, to }) => from + to)
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
})
