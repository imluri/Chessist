// Stockfish reports scores from the side-to-move's perspective. Convert to
// White's perspective (positive = good for White) so the bar doesn't flip each move.
function whiteRelative(ev) {
  const sign = ev.turn === 'b' ? -1 : 1
  return {
    cp: ev.cp !== undefined ? ev.cp * sign : undefined,
    mate: ev.mate !== undefined ? ev.mate * sign : undefined,
  }
}

function fmt(cp, mate) {
  if (mate !== undefined) return `M${mate}`
  if (cp !== undefined) { const p = cp / 100; return (p >= 0 ? '+' : '') + p.toFixed(2) }
  return '—'
}

function Stat({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: 'rgb(var(--fg-dim))', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )
}

export default function EvalPanel({ ev, pending }) {
  // Keep the last score visible while evaluating the new position.
  const previousGameOver = pending && ev?.gameOver
  const current = previousGameOver ? {} : (ev || {})
  const gameOver = current.gameOver
  const checkmate = gameOver === 'checkmate'
  const { cp, mate } = whiteRelative(current)
  let fill = 50
  if (checkmate) fill = current.winner === 'w' ? 100 : 0
  else if (mate !== undefined) fill = mate > 0 ? 95 : 5
  else if (cp !== undefined) fill = 50 + Math.max(-45, Math.min(45, cp / 50))
  const score = gameOver ? (checkmate ? 'Checkmate' : 'Stalemate') : fmt(cp, mate)
  const detail = pending ? 'Analyzing…' : gameOver
    ? (checkmate ? `${current.winner === 'w' ? 'White' : 'Black'} wins` : 'Draw')
    : `depth ${current.depth}`

  return (
    <div>
      {/* eval bar */}
      <div style={{ height: 6, background: 'rgb(var(--surface))', position: 'relative', overflow: 'hidden', borderRadius: 999 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`,
          background: 'rgb(var(--accent))', boxShadow: '0 0 8px rgba(var(--accent-rgb),0.55)', transition: 'width 0.25s',
        }} />
      </div>

      {/* score */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 2px 12px' }}>
        <span style={{ fontSize: gameOver ? 24 : 28, lineHeight: '34px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
        <span style={{ fontSize: 12, color: 'rgb(var(--fg-muted))', fontVariantNumeric: 'tabular-nums' }}>{detail}</span>
      </div>

      {/* stats — no table borders, app font */}
      <div style={{ display: 'flex', gap: 28, padding: '0 2px', visibility: gameOver ? 'hidden' : undefined }}>
        <Stat label="Best move" value={pending ? '—' : (current.bestMove ?? '—')} />
        <Stat label="Depth" value={current.depth ?? '—'} />
        <Stat label="kNPS" value={current.nps ? Math.round(current.nps / 1000) : '—'} />
      </div>
    </div>
  )
}
