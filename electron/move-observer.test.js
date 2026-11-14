import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../extension/src/content/move-observer.js', import.meta.url), 'utf8')
const ordinary = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'

function setup(before = ordinary, move = 'e2e4') {
  vi.useFakeTimers()
  let snapshot = { fen: before, context: 'round-a' }
  const report = vi.fn()
  const fixture = { setTimeout, clearTimeout }
  runInNewContext(source, fixture)
  const observer = fixture.ChessistMoveObserver.create({ read: () => snapshot, report })
  const attempt = observer.begin({ move, before, context: snapshot.context })
  return {
    observer, attempt, report,
    update(fen, context = 'round-a') {
      snapshot = { fen, context }
      observer.observe()
    },
  }
}

afterEach(() => vi.useRealTimers())

it.each([
  ['e2e4', ordinary, '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1'],
  ['e1g1', '4k3/8/8/8/8/8/8/4K2R w K - 0 1', '4k3/8/8/8/8/8/8/5RK1 b - - 1 1'],
  ['e5d6', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1'],
  ['a7a8n', '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'N3k3/8/8/8/8/8/8/4K3 b - - 0 1'],
])('confirms %s only when the expected placement is observed', (move, before, after) => {
  const { observer, attempt, report, update } = setup(before, move)
  expect(report).toHaveBeenLastCalledWith({ move, state: 'sending' })
  observer.sent(attempt)
  expect(report).toHaveBeenCalledTimes(1)
  update(after)
  expect(report).toHaveBeenLastCalledWith({ move, state: 'confirmed' })
  vi.runAllTimers()
  expect(report).toHaveBeenCalledTimes(2)
})

it('distinguishes unchanged, changed, unreadable, and dispatch failures', () => {
  for (const [fen, error, state] of [
    [ordinary, undefined, 'unchanged'],
    ['4k3/8/8/8/8/4P3/8/4K3 b - - 0 1', undefined, 'changed'],
    [null, undefined, 'unverified'],
    [ordinary, 'Input returned an error', 'dispatch_error'],
  ]) {
    const { observer, attempt, report, update } = setup()
    observer.sent(attempt, error)
    update(fen)
    vi.runAllTimers()
    expect(report).toHaveBeenLastCalledWith({ move: 'e2e4', state })
  }
})

it('does not use a different round to confirm an attempt', () => {
  const { report, update } = setup()
  update('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1', 'round-b')
  expect(report).toHaveBeenLastCalledWith({ move: 'e2e4', state: 'unverified' })
})

it('does not confirm a move that was already visible before dispatch', () => {
  const { observer, report, update } = setup()
  const after = '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1'
  observer.reset()
  update(after)
  const attempt = observer.begin({ move: 'e2e4', before: ordinary, context: 'round-a' })
  observer.sent(attempt)
  vi.runAllTimers()
  expect(report).toHaveBeenLastCalledWith({ move: 'e2e4', state: 'unverified' })
})
