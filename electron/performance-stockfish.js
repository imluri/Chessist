const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { parseInfoLine } = require('./engine')

const DEPTH = 13
const SAMPLE_COUNT = 9
const FIRST_EVAL_DEPTH = 5
const POSITIONS = [
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
]

async function benchmarkStockfish(path, cancellation) {
  const deadline = AbortSignal.timeout(25000)
  const signal = cancellation ? AbortSignal.any([cancellation, deadline]) : deadline
  signal.throwIfAborted()
  const child = spawn(path, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let pending
  let failure
  let exited = false
  const fail = error => {
    failure ??= error
    pending?.reject(failure)
  }
  const closed = new Promise(resolve => {
    child.once('close', () => {
      exited = true
      fail(new Error('Stockfish exited before the benchmark completed.'))
      resolve()
    })
  })
  child.on('error', error => fail(new Error(`Could not start Stockfish: ${error.message}`)))
  child.stdin.on('error', error => fail(error))
  child.stdout.on('error', error => fail(error))
  const abort = () => {
    fail(deadline.aborted ? new Error('The Stockfish benchmark timed out.') : signal.reason)
    child.kill()
  }
  signal.addEventListener('abort', abort, { once: true })
  lines.on('line', line => {
    if (!pending) return
    try {
      if (pending.until(line)) pending.resolve()
    } catch (error) {
      pending.reject(error)
    }
  })

  async function exchange(commands, until) {
    if (failure) throw failure
    try {
      await new Promise((resolve, reject) => {
        pending = { until, resolve, reject }
        child.stdin.write(commands + '\n')
      })
    } finally {
      pending = null
    }
  }

  async function search(fen) {
    // Clear the transposition table so each sample searches a fresh position.
    await exchange('ucinewgame\nisready', line => line === 'readyok')
    let firstEval
    let fixedDepth
    const start = performance.now()
    await exchange(`position fen ${fen}\ngo depth ${DEPTH}`, line => {
      if (line.startsWith('info depth ')) {
        const score = parseInfoLine(line)
        if (score && score.depth >= FIRST_EVAL_DEPTH) {
          const elapsed = performance.now() - start
          firstEval ??= elapsed
          if (score.depth >= DEPTH) fixedDepth ??= elapsed
        }
      }
      return line.startsWith('bestmove ')
    })
    if (firstEval === undefined || fixedDepth === undefined) {
      throw new Error('Stockfish did not return a scored evaluation at the benchmark depth.')
    }
    return { firstEval, fixedDepth }
  }

  try {
    await exchange('uci', line => line === 'uciok')
    await exchange([
      'setoption name Threads value 1',
      'setoption name Hash value 128',
      'setoption name MultiPV value 1',
      'isready',
    ].join('\n'), line => line === 'readyok')
    await search(POSITIONS[0]) // Warm up the executable and its evaluation network.
    const firstEvalMs = []
    const fixedDepthMs = []
    for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
      const { firstEval, fixedDepth } = await search(POSITIONS[sample % POSITIONS.length])
      firstEvalMs.push(firstEval)
      fixedDepthMs.push(fixedDepth)
    }
    return { firstEvalMs, fixedDepthMs, depth: DEPTH }
  } finally {
    signal.removeEventListener('abort', abort)
    if (!exited && !child.killed) {
      // Give Stockfish a short chance to quit, then stop the isolated process.
      const forceQuit = setTimeout(() => child.kill(), 500)
      try {
        child.stdin.end('quit\n')
        await closed
      } finally {
        clearTimeout(forceQuit)
      }
    } else {
      await closed
    }
    lines.close()
  }
}

module.exports = { benchmarkStockfish }
