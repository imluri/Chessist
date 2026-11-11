import { describe, it, expect, vi } from 'vitest'
import { defaultHashMb, Engine, parseInfoLine } from './engine.js'

describe('parseInfoLine', () => {
  it('parses cp score and pv', () => {
    const r = parseInfoLine('info depth 20 multipv 1 score cp 35 nps 1200000 pv e2e4 e7e5')
    expect(r).toEqual({ depth: 20, multipv: 1, cp: 35, nps: 1200000, pv: ['e2e4', 'e7e5'], bestMove: 'e2e4' })
  })

  it('parses mate score', () => {
    const r = parseInfoLine('info depth 12 multipv 1 score mate 3 pv d1h5 g8h6')
    expect(r.mate).toBe(3)
    expect(r.cp).toBeUndefined()
    expect(r.bestMove).toBe('d1h5')
  })

  it('returns null for non-score lines', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-xxxx.nnue')).toBeNull()
  })
})

describe('defaultHashMb', () => {
  it('returns a value clamped to [128, 1024]', () => {
    const v = defaultHashMb()
    expect(v).toBeGreaterThanOrEqual(128)
    expect(v).toBeLessThanOrEqual(1024)
  })
})

describe('engine startup', () => {
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const nextFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

  it('starts the most recent search only after Stockfish is ready', () => {
    const engine = new Engine()
    const send = vi.spyOn(engine, '_send')
    engine.evaluate(startFen, 18, 1)
    engine.evaluate(nextFen, 20, 3)
    expect(send).not.toHaveBeenCalled()

    engine._handle('readyok')
    engine._handle('readyok')

    expect(send.mock.calls.flat()).toEqual([
      'setoption name MultiPV value 3', 'stop', `position fen ${nextFen}`, 'go depth 20',
    ])
  })

  it.each(['stop', 'newGame'])('discards a queued search on %s', (method) => {
    const engine = new Engine()
    const send = vi.spyOn(engine, '_send')
    engine.evaluate(startFen, 18, 1)
    engine[method]()
    engine._handle('readyok')
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a missing executable as a launch failure', async () => {
    const errorStatus = await new Promise((resolve) => {
      const engine = new Engine(undefined, (status) => {
        if (status.status === 'error') resolve(status)
      })
      // The engine source file is not a directory, so this cannot resolve to an executable.
      engine.start(require('node:path').join(__dirname, 'engine.js', 'stockfish.exe'))
    })
    expect(errorStatus.message).toMatch(/^Stockfish could not start:/)
  })
})
