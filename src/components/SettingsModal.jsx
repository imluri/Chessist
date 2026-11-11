import { useEffect, useState } from 'react'
import GamePage from '../pages/GamePage'
import EnginePage from '../pages/EnginePage'

const TABS = [
  { id: 'game', label: 'Game' },
  { id: 'engine', label: 'Engine' },
  { id: 'developer', label: 'Developer' },
]

function DeveloperPage() {
  const [open, setOpen] = useState(false)
  const toggle = async () => { setOpen(await window.chessist.toggleDevTools()) }
  return (
    <div style={{ padding: 16 }}>
      <div className="scard" style={{ padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', color: 'rgb(var(--fg-muted))', marginBottom: 8 }}>DEVELOPER TOOLS</div>
        <div style={{ fontSize: 12, color: 'rgb(var(--fg-dim))', marginBottom: 12, lineHeight: 1.5 }}>
          Open Chrome DevTools for this app window — inspect the renderer, read console logs, and debug the UI.
        </div>
        <button
          onClick={toggle}
          style={{
            padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)',
            background: open ? 'rgb(var(--surface))' : 'rgb(var(--accent))',
            color: open ? 'rgb(var(--fg))' : '#fff',
            border: open ? '1px solid rgb(var(--border))' : 'none',
          }}
        >
          {open ? 'Close DevTools' : 'Open DevTools'}
        </button>
      </div>
    </div>
  )
}

export default function SettingsModal({ onClose, gameSettings, engineSettings, onGameChange, onEngineChange }) {
  const [tab, setTab] = useState('game')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          background: 'rgb(var(--bg))', border: '1px solid rgb(var(--border))',
          borderRadius: 'var(--radius)', overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid rgb(var(--border))' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '11px 18px', fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none',
                color: tab === t.id ? 'rgb(var(--fg))' : 'rgb(var(--fg-muted))',
                borderBottom: tab === t.id ? '2px solid rgb(var(--accent))' : '2px solid transparent',
              }}>{t.label}</button>
          ))}
          <button onClick={onClose} aria-label="Close settings" title="Close"
            style={{ marginLeft: 'auto', marginRight: 6, width: 36, height: 36, background: 'transparent', border: 'none', color: 'rgb(var(--fg-muted))', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {tab === 'game' && <GamePage settings={gameSettings} onChange={onGameChange} />}
          {tab === 'engine' && <EnginePage settings={engineSettings} onChange={onEngineChange} />}
          {tab === 'developer' && <DeveloperPage />}
        </div>
      </div>
    </div>
  )
}
