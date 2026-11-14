const { writeFile } = require('node:fs/promises')

const MAX_EVENTS = 500
const MOVE_WAIT_REASONS = new Set([
  'previous_input', 'countdown', 'inactive', 'position_changed', 'game_changed',
  'board_missing', 'premove', 'turn_unconfirmed', 'board_unsettled',
])
const MOVE_EXECUTORS = new Set(['cdp-dom-input', 'main-world-dom-input'])
const MOVE_OUTCOMES = new Set(['sending', 'confirmed', 'unchanged', 'changed', 'unverified', 'dispatch_error'])
const ENGINE_PHASES = new Set(['starting', 'searching', 'idle'])
const ENGINE_REASONS = new Set([
  'Stockfish could not start', 'Stockfish did not respond during startup',
  'Stockfish could not allocate hash memory', 'Stockfish rejected a board position',
  'Stockfish could not load its evaluation network', 'Stockfish could not configure processor affinity',
  'Stockfish reported an unrecognized error', 'Stockfish gave no error details',
])
const ENGINE_STATES = new Set(['starting', 'downloading', 'ready', 'retrying', 'error'])

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined
}

function moveDiagnostic(data) {
  const event = data?.event
  const elapsedMs = integer(data?.elapsedMs, 0, 600000)
  switch (event) {
    case 'move_queued': return { event, depth: integer(data.depth, 1, 100) }
    case 'move_dispatch': return { event, elapsedMs }
    case 'move_waiting':
      return MOVE_WAIT_REASONS.has(data.reason) ? { event, reason: data.reason, elapsedMs } : null
    case 'move_relay':
      if (typeof data.success !== 'boolean') return null
      return { event, elapsedMs, success: data.success, executor: MOVE_EXECUTORS.has(data.executor) ? data.executor : undefined }
    default: return null
  }
}

function engineDiagnostic(data) {
  const event = data?.event
  switch (event) {
    case 'engine_start':
    case 'engine_settings':
      return { event, threads: integer(data.threads, 1, 1024), hash: integer(data.hash, 1, 1048576) }
    case 'engine_ready': return { event }
    case 'engine_exit':
      return { event, code: integer(data.code, -2147483648, 4294967295) ?? null,
        phase: ENGINE_PHASES.has(data.phase) ? data.phase : undefined,
        reason: ENGINE_REASONS.has(data.reason) ? data.reason : undefined }
    case 'engine_retry':
    case 'engine_recovered': return { event, attempt: integer(data.attempt, 1, 3) }
    default: return null
  }
}

class Diagnostics {
  constructor() {
    this.enabled = false
    this.events = []
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return
    if (enabled) {
      this.enabled = true
      this.record({ event: 'recording_started' })
    } else {
      this.record({ event: 'recording_paused' })
      this.enabled = false
    }
  }

  record(data) {
    if (!this.enabled || !data) return
    const { event } = data
    const safe = ['recording_started', 'recording_paused'].includes(event) ? { event }
      : event === 'move_outcome' && MOVE_OUTCOMES.has(data.state) ? { event, state: data.state }
      : event === 'engine_status' && ENGINE_STATES.has(data.state) ? { event, state: data.state }
      : moveDiagnostic(data) ?? engineDiagnostic(data)
    if (!safe) return
    if (this.events.length === MAX_EVENTS) this.events.shift()
    this.events.push({ time: new Date().toISOString(), ...safe })
  }

  async export(file, version) {
    const report = { formatVersion: 1, appVersion: version, platform: process.platform, architecture: process.arch,
      exportedAt: new Date().toISOString(), events: this.events }
    await writeFile(file, JSON.stringify(report, null, 2) + '\n', 'utf8')
  }
}

module.exports = { Diagnostics, moveDiagnostic }
