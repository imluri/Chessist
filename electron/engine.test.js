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
      'setoption name MultiPV value 3', `position fen ${nextFen}`, 'go depth 20',
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

describe('Engine evaluation queue', () => {
  const first = '8/8/8/8/8/8/8/K6k w - - 0 1'
  const next = '8/8/8/8/8/8/8/K6k b - - 0 1'

  it('does not restart an identical active search', () => {
    const engine = new Engine()
    engine.ready = true
    const send = vi.spyOn(engine, '_send')

    engine.evaluate(first, 18, 1)
    engine.evaluate(first, 18, 1)

    expect(send.mock.calls.flat()).toEqual([
      `position fen ${first}`,
      'go depth 18',
    ])
  })

  it('waits for the old bestmove before starting the newest position', () => {
    const engine = new Engine()
    engine.ready = true
    const send = vi.spyOn(engine, '_send')

    engine.evaluate(first, 18, 1)
    send.mockClear()
    engine.evaluate(next, 18, 3)
    expect(send.mock.calls.flat()).toEqual(['stop'])

    engine._handle('bestmove a1a2')
    expect(send.mock.calls.flat()).toEqual([
      'stop', 'setoption name MultiPV value 3', `position fen ${next}`, 'go depth 18',
    ])
  })

  it('stops before applying changed settings and resumes with the latest position', () => {
    const engine = new Engine()
    engine.ready = true
    const send = vi.spyOn(engine, '_send')
    engine.evaluate(first, 18, 1)
    send.mockClear()

    engine.applySetting('skillLevel', 12)
    engine.applySetting('skillLevel', 8)
    engine.applySetting('limitStrength', true)
    engine.applySetting('elo', 1800)
    engine.evaluate(next, 18, 1)
    expect(send.mock.calls.flat()).toEqual(['stop'])

    engine._handle('bestmove a1a2')
    expect(send.mock.calls.flat()).toEqual([
      'stop', 'setoption name Skill Level value 8', 'setoption name UCI_LimitStrength value true',
      'setoption name UCI_Elo value 1800', `position fen ${next}`, 'go depth 18',
    ])
  })

  it('refreshes a completed evaluation after a settings change and respects an explicit stop', () => {
    const engine = new Engine()
    engine.ready = true
    const send = vi.spyOn(engine, '_send')
    engine.evaluate(first, 18, 1)
    engine._handle('bestmove a1a2')
    send.mockClear()

    engine.applySetting('threads', 2)
    expect(send.mock.calls.flat()).toEqual([
      'setoption name Threads value 2', `position fen ${first}`, 'go depth 18',
    ])

    engine.stop()
    engine._handle('bestmove a1a2')
    send.mockClear()
    engine.applySetting('threads', 3)
    expect(send.mock.calls.flat()).toEqual(['setoption name Threads value 3'])
  })

  it('keeps the latest request when it returns to the position being stopped', () => {
    const engine = new Engine()
    engine.ready = true
    const send = vi.spyOn(engine, '_send')

    engine.evaluate(first, 18, 1)
    send.mockClear()
    engine.evaluate(next, 18, 3)
    engine.evaluate(first, 18, 1)
    expect(send.mock.calls.flat()).toEqual(['stop'])

    engine._handle('bestmove a1a2')
    expect(send.mock.calls.flat()).toEqual(['stop', `position fen ${first}`, 'go depth 18'])
  })

  it('waits for the old search to stop and the new game to be ready', () => {
    const onEval = vi.fn()
    const engine = new Engine(onEval)
    engine.ready = true
    const send = vi.spyOn(engine, '_send')

    engine.evaluate(first, 18, 1)
    send.mockClear()
    engine.newGame()
    engine.evaluate(next, 18, 3)
    expect(send.mock.calls.flat()).toEqual(['stop'])

    engine._handle('bestmove (none)')
    expect(onEval).not.toHaveBeenCalled()
    expect(send.mock.calls.flat()).toEqual(['stop', 'ucinewgame', 'isready'])

    engine._handle('readyok')
    expect(send.mock.calls.flat()).toEqual([
      'stop', 'ucinewgame', 'isready', 'setoption name MultiPV value 3', `position fen ${next}`, 'go depth 18',
    ])
  })
})
