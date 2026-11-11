import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../extension/src/content/lichess.js', import.meta.url), 'utf8')
const fixtureScript = source.replace(/\}\)\(\);\s*$/, `
  globalThis.roundHelpers = {
    getGameId, isInOwnGame, applyPushedSettings,
    evaluateOpening() {
      const moves = [];
      _executeMoveVerified = move => moves.push(move);
      currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      currentTurn = 'w';
      playerColor = detectPlayerColor();
      autoMove = true;
      instantMove = true;
      overlayMode = false;
      suppressInPage = true;
      updateEval({ fen: currentFen, turn: 'w', depth: 11, bestMove: 'e2e4' });
      return moves;
    },
  };
})();
`)

function loadRound(pathname, { participant = false, runningClock = false, boardInRound = true } = {}) {
  const ignore = () => {}
  const board = { classList: { contains: name => name === 'orientation-white' } }
  const controls = participant ? new Set(['.rcontrols .ricons']) : new Set()
  const round = {
    contains: element => boardInRound && element === board,
    querySelector: selector => {
      const parts = selector.split(',').map(part => part.trim())
      if (boardInRound && parts.some(part => part === 'cg-wrap' || part === '.cg-wrap')) return board
      if (parts.some(part => controls.has(part))) return {}
      if (runningClock && parts.includes('.rclock-bottom.running')) return {}
      return null
    },
  }
  const fixture = {
    window: { location: { pathname }, addEventListener: ignore },
    document: {
      readyState: 'loading',
      addEventListener: ignore,
      querySelector: selector => {
        const parts = selector.split(',').map(part => part.trim())
        if (parts.includes('.round__app')) return round
        if (parts.includes('cg-wrap') || parts.includes('.cg-wrap')) return board
        return null
      },
    },
    chrome: {
      runtime: {
        connect: () => ({ onDisconnect: { addListener: ignore } }),
        onMessage: { addListener: ignore },
      },
    },
    matchMedia: () => ({ addEventListener: ignore }),
    setInterval: ignore,
  }
  runInNewContext(fixtureScript, fixture)
  return fixture.roundHelpers
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
    expect(round.evaluateOpening()).toEqual(['e2e4'])
  })

  it('keeps a spectated round read-only even with a running clock and a manual color', () => {
    const round = loadRound('/game/aB3dEf56/white', { runningClock: true })
    round.applyPushedSettings({ playerColor: 'white' })
    expect(round.isInOwnGame()).toBe(false)
    expect(round.evaluateOpening()).toEqual([])
  })

  it('requires the board to be inside the round with participant controls', () => {
    expect(loadRound('/game/aB3dEf56', { participant: true, boardInRound: false }).isInOwnGame()).toBe(false)
  })

  it('does not treat an analysis board as a player round', () => {
    expect(loadRound('/analysis').isInOwnGame()).toBe(false)
  })
})
