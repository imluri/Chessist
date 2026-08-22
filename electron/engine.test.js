import { describe, it, expect, vi } from 'vitest'
import { parseInfoLine, Engine } from './engine.js'

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

import { defaultHashMb } from './engine.js'

describe('defaultHashMb', () => {
  it('returns a value clamped to [128, 1024]', () => {
    const v = defaultHashMb()
    expect(v).toBeGreaterThanOrEqual(128)
    expect(v).toBeLessThanOrEqual(1024)
  })
})

describe('Engine evaluation queue', () => {
  it('does not restart an identical active search', () => {
    const engine = new Engine()
    engine.ready = true
    engine._send = vi.fn()
    const fen = '8/8/8/8/8/8/8/K6k w - - 0 1'

    engine.evaluate(fen, 18, 1)
    engine.evaluate(fen, 18, 1)

    expect(engine._send.mock.calls.map(c => c[0])).toEqual([
      `position fen ${fen}`,
      'go depth 18',
    ])
  })

  it('waits for the old bestmove before starting the newest position', () => {
    const engine = new Engine()
    engine.ready = true
    engine._send = vi.fn()
    const first = '8/8/8/8/8/8/8/K6k w - - 0 1'
    const latest = '8/8/8/8/8/8/8/K6k b - - 0 1'

    engine.evaluate(first, 18, 1)
    engine.evaluate(latest, 18, 3)
    expect(engine.curFen).toBe(first)
    expect(engine._send).toHaveBeenLastCalledWith('stop')

    engine._handle('bestmove a1a2')
    expect(engine.curFen).toBe(latest)
    expect(engine.searching).toBe(true)
    expect(engine._send.mock.calls.map(c => c[0])).toContain(`position fen ${latest}`)
  })
})
