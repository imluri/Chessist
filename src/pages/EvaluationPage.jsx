import EvalPanel from '../components/EvalPanel'
import Board from '../components/Board'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const piecesKey = (fen) => (fen ? fen.split(' ')[0] : '')
const STOCKFISH_LABELS = {
  starting: 'Starting Stockfish…',
  retrying: 'Restarting Stockfish…',
  downloading: 'Downloading Stockfish…',
  error: 'Stockfish unavailable',
}
const AUTO_MOVE_LABELS = {
  sending: 'Waiting for the browser board…',
  confirmed: 'Expected move appeared on the browser board.',
  unchanged: 'The browser board was still on the same position when the check ended.',
  changed: 'The board advanced without confirming the expected move.',
  unverified: 'The browser board could not be verified.',
  dispatch_error: 'The browser reported an input error and the move was not confirmed.',
}

function AutoMoveStatus({ status }) {
  const label = AUTO_MOVE_LABELS[status?.state]
  const move = status?.move
  const promotion = move?.length === 5 ? `=${move[4].toUpperCase()}` : ''
  return <div role="status" aria-atomic="true" style={{ color: 'rgb(var(--fg-muted))' }}>
    {label && <><strong>Last Auto-move attempt {move.slice(0, 2)} → {move.slice(2, 4)}{promotion}.</strong> {label}</>}
  </div>
}

// Locate a side's king on the board, e.g. ('…', 'w') → 'e1'. Returns null if absent.
function kingSquare(fen, color) {
  const target = color === 'w' ? 'K' : 'k'
  const rows = (fen || '').split(' ')[0].split('/')
  for (let r = 0; r < rows.length; r++) {
    let file = 0
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { file += +ch; continue }
      if (ch === target) return String.fromCharCode(97 + file) + (8 - r)
      file++
    }
  }
  return null
}

function arrowsFromEval(ev, showAltArrows) {
  const moves = (ev.multiPvMoves && ev.multiPvMoves.length) ? ev.multiPvMoves : (ev.bestMove ? [ev.bestMove] : [])
  return moves
    .filter(m => typeof m === 'string' && m.length >= 4)
    .slice(0, showAltArrows ? 3 : 1)
    .map((m, i) => ({ from: m.slice(0, 2), to: m.slice(2, 4), idx: i }))
}

export default function EvaluationPage({ ev, pos, status, gameSettings, autoMoveStatus, onOpenSetup }) {
  const chessOn = status.chessConnected        // a chess tab is active
  const extOn = status.extensionConnected      // extension installed (service worker)
  const boardFen = pos?.fen || ev?.fen || START_FEN
  const flipped = !!pos?.flipped
  const hasPosition = !!(pos?.fen || ev?.fen)
  const analysisEnabled = gameSettings?.enabled !== false

  const evalMatches = ev?.fen && (!pos?.fen || piecesKey(ev.fen) === piecesKey(pos.fen))
  const showPanel = status.stockfishState === 'ready' && analysisEnabled && chessOn && hasPosition
  const showCurrentEval = showPanel && evalMatches
  const gameOver = showCurrentEval ? ev.gameOver : null
  const arrows = (showCurrentEval && !gameOver) ? arrowsFromEval(ev, gameSettings?.showAltArrows) : []

  // On checkmate the side to move is mated — ring its king in red.
  const kingMark = gameOver === 'checkmate'
    ? { square: kingSquare(boardFen, ev.turn), color: 'rgb(var(--status-red))' }
    : null
  const overText = gameOver === 'checkmate'
    ? `Checkmate — ${ev.winner === 'w' ? 'White' : 'Black'} wins`
    : gameOver === 'stalemate' ? 'Stalemate — Draw' : null

  const site = status.chessSite || 'a chess site'
  const stockfishFailed = status.stockfishState === 'error'
  let dot = 'rgb(var(--status-yellow))'
  let labelColor = 'rgb(var(--fg-muted))'
  let label, hint
  if (STOCKFISH_LABELS[status.stockfishState]) {
    label = STOCKFISH_LABELS[status.stockfishState]
    if (stockfishFailed) dot = labelColor = 'rgb(var(--status-red))'
  } else if (status.stockfishState === 'ready' && !analysisEnabled) {
    label = 'Analysis disabled'
  } else if (chessOn) {
    label = hasPosition ? 'Analyzing…' : `On ${site}`
    hint = hasPosition ? '' : `You're on ${site} — start a game to see analysis.`
  } else if (extOn) {
    label = 'Connected to extension'
    hint = "Connected to the extension, but couldn't detect a game. Open a game on chess.com or lichess.org."
  } else {
    dot = labelColor = 'rgb(var(--status-red))'
    label = 'Disconnected'
    hint = 'No connection. Open the Setup tab to load the extension, then open a game.'
  }

  // Board greys out whenever there's no live game; fully grey when nothing is connected.
  const boardOpacity = chessOn ? (hasPosition ? 1 : 0.5) : (extOn ? 0.6 : 0.4)
  const boardFilter = chessOn ? (hasPosition ? 'none' : 'grayscale(0.4)') : (extOn ? 'grayscale(0.85)' : 'grayscale(1)')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 12, overflow: 'hidden' }}>
      {/* Keep the header mounted between a position update and its evaluation. */}
      <div style={{ flexShrink: 0 }}>
        {showPanel ? <EvalPanel ev={ev} pending={!showCurrentEval} /> : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
            <span role="status" style={{ color: labelColor, fontWeight: 600 }}>{label}</span>
            {stockfishFailed && (
              <button type="button" onClick={onOpenSetup} style={{
                padding: '4px 8px', border: '1px solid rgb(var(--border))', borderRadius: 'var(--radius-sm)',
                background: 'rgb(var(--surface))', color: 'rgb(var(--fg))', fontSize: 12, cursor: 'pointer',
              }}>
                Open Setup
              </button>
            )}
          </div>
        )}
      </div>

      {/* board fills the remaining space, kept square and bounded by both axes */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ height: '100%', maxWidth: '100%', aspectRatio: '1 / 1', position: 'relative', opacity: boardOpacity, filter: boardFilter }}>
          <Board fen={boardFen} arrows={arrows} flipped={flipped} kingMark={kingMark} fill />
          {overText && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(10,10,14,0.86)', color: '#fff', padding: '8px 16px', borderRadius: 'var(--radius)',
                fontWeight: 700, fontSize: 14, border: '1px solid rgb(var(--border))', boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              }}>{overText}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 12, color: 'rgb(var(--fg-dim))', lineHeight: 1.6, minHeight: 18 }}>
        {hint}
        <AutoMoveStatus status={autoMoveStatus} />
      </div>
    </div>
  )
}
