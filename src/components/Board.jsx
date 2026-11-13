import BOARD_IMG from '../assets/board/1.png'
import bb from '../assets/pieces/bb.png'
import bk from '../assets/pieces/bk.png'
import bn from '../assets/pieces/bn.png'
import bp from '../assets/pieces/bp.png'
import bq from '../assets/pieces/bq.png'
import br from '../assets/pieces/br.png'
import wb from '../assets/pieces/wb.png'
import wk from '../assets/pieces/wk.png'
import wn from '../assets/pieces/wn.png'
import wp from '../assets/pieces/wp.png'
import wq from '../assets/pieces/wq.png'
import wr from '../assets/pieces/wr.png'

// Renders a chess position from FEN with best-move arrows.
const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
const ARROW_COLORS = ['rgb(var(--accent))', 'rgb(var(--status-yellow))', 'rgb(var(--status-red))']

const PIECE_IMGS = { bb, bk, bn, bp, bq, br, wb, wk, wn, wp, wq, wr }

function parseFen(fen) {
  const rows = (fen || '').split(' ')[0].split('/')
  const grid = []
  for (const row of rows) {
    const r = []
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) r.push(null)
      else r.push(ch)
    }
    while (r.length < 8) r.push(null)
    grid.push(r.slice(0, 8))
  }
  while (grid.length < 8) grid.push(Array(8).fill(null))
  return grid // grid[0] = rank 8 (top), grid[7] = rank 1
}

// square "e4" → center in an 8x8 viewBox (respecting board orientation)
function center(sq, flipped) {
  const file = sq.charCodeAt(0) - 97       // a=0..h=7
  const rank = parseInt(sq[1], 10) - 1      // 1=0..8=7
  const x = flipped ? (7 - file) + 0.5 : file + 0.5
  const y = flipped ? rank + 0.5 : (7 - rank) + 0.5
  return { x, y }
}

function Arrow({ from, to, idx, flipped }) {
  const a = center(from, flipped), b = center(to, flipped)
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 0.01) return null
  const ux = dx / len, uy = dy / len
  const head = 0.34, hw = 0.16
  const shaftEnd = { x: b.x - ux * head * 0.8, y: b.y - uy * head * 0.8 }
  const px = -uy, py = ux
  const p1 = `${b.x},${b.y}`
  const p2 = `${b.x - ux * head + px * hw},${b.y - uy * head + py * hw}`
  const p3 = `${b.x - ux * head - px * hw},${b.y - uy * head - py * hw}`
  const c = ARROW_COLORS[idx] || ARROW_COLORS[0]
  return (
    <g style={{ opacity: idx === 0 ? 0.95 : 0.6 }}>
      <line x1={a.x} y1={a.y} x2={shaftEnd.x} y2={shaftEnd.y} stroke={c} strokeWidth={0.13} strokeLinecap="round" />
      <polygon points={`${p1} ${p2} ${p3}`} fill={c} />
    </g>
  )
}

function Piece({ piece }) {
  const isWhite = piece === piece.toUpperCase()
  const key = (isWhite ? 'w' : 'b') + piece.toLowerCase()
  const img = PIECE_IMGS[key]
  if (img) {
    return <img src={img} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
  }
  // Fallback: unicode glyph
  return (
    <span style={{
      fontSize: 'min(5.2vw, 28px)', lineHeight: 1,
      color: isWhite ? '#f4f4f6' : '#0e0e12',
      textShadow: isWhite ? '0 1px 1px rgba(0,0,0,0.5)' : '0 0 1px rgba(255,255,255,0.4)',
    }}>{GLYPH[piece.toLowerCase()]}</span>
  )
}

export default function Board({ fen, arrows = [], flipped = false, maxWidth = 360, fill = false, kingMark = null }) {
  if (!fen) return null
  let grid = parseFen(fen)
  if (flipped) grid = grid.map(row => [...row].reverse()).reverse() // black's perspective
  const hasBoardImg = !!BOARD_IMG

  // fill: occupy the parent (which enforces the square). Otherwise center with a max width.
  const outer = fill
    ? { position: 'relative', width: '100%', height: '100%', borderRadius: 'var(--radius)', overflow: 'hidden' }
    : { position: 'relative', width: '100%', maxWidth, margin: '0 auto', aspectRatio: '1 / 1', borderRadius: 'var(--radius)', overflow: 'hidden' }

  return (
    <div style={outer}>
      {hasBoardImg && (
        <img src={BOARD_IMG} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} />
      )}
      <div style={{
        position: 'relative', display: 'grid',
        gridTemplateColumns: 'repeat(8,1fr)', gridTemplateRows: 'repeat(8,1fr)',
        width: '100%', height: '100%',
        border: hasBoardImg ? 'none' : '1px solid rgb(var(--border))',
      }}>
        {grid.flatMap((row, r) => row.map((piece, f) => {
          const dark = (r + f) % 2 === 1
          // Only paint square colors when there's no board image behind.
          const bg = hasBoardImg ? 'transparent' : (dark ? '#26262e' : '#3a3a44')
          return (
            <div key={`${r}-${f}`} style={{ background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {piece && <Piece piece={piece} />}
            </div>
          )
        }))}
      </div>
      <svg viewBox="0 0 8 8" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {kingMark?.square && (() => {
          const c = center(kingMark.square, flipped)
          return (
            <g>
              <rect x={c.x - 0.5} y={c.y - 0.5} width={1} height={1} fill={kingMark.color} opacity={0.28} />
              <circle cx={c.x} cy={c.y} r={0.45} fill="none" stroke={kingMark.color} strokeWidth={0.1} opacity={0.95} />
            </g>
          )
        })()}
        {arrows.map((a, i) => <Arrow key={i} from={a.from} to={a.to} idx={a.idx ?? i} flipped={flipped} />)}
      </svg>
    </div>
  )
}
