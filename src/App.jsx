import { useEffect, useState, useRef } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import EvaluationPage from './pages/EvaluationPage'
import SetupPage from './pages/SetupPage'
import AboutPage from './pages/AboutPage'

const piecesKey = (fen) => (fen ? fen.split(' ')[0] : '')

export default function App() {
  const [status, setStatus] = useState({ stockfishOk: false, stockfishState: 'starting', overlayOk: false, extensionConnected: false, chessConnected: false, chessSite: null, message: '' })
  const [ev, setEv] = useState(null)
  const [pos, setPos] = useState(null)        // { fen, flipped } — authoritative current position
  const [page, setPage] = useState('evaluation')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const posRef = useRef(null)

  useEffect(() => {
    window.chessist.getStatus().then(setStatus)
    const offS = window.chessist.onStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.stockfishState !== 'ready') setEv(null)
    })
    const offP = window.chessist.onPosition?.((p) => { posRef.current = p; setPos(p) })
    const offE = window.chessist.onEval((e) => {
      // Ignore speculative / stale evals — only show ones for the current board.
      const cur = posRef.current?.fen
      if (cur && e.fen && piecesKey(e.fen) !== piecesKey(cur)) return
      setEv(e)
    })
    // Auto-check for updates on launch.
    window.chessist.checkUpdate?.().then(setUpdateStatus).catch(() => {})
    return () => { offS(); offE(); offP && offP() }
  }, [])

  const updateAvailable = !!updateStatus?.available

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'rgb(var(--bg))' }}>
      <TitleBar onSettings={() => setSettingsOpen(true)} />
      {updateAvailable && page !== 'about' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: 'rgb(var(--surface))', borderBottom: '1px solid rgb(var(--border))', fontSize: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgb(var(--status-yellow))', flexShrink: 0 }} />
          <span style={{ flex: 1, color: 'rgb(var(--fg-muted))' }}>A new version is available.</span>
          <button onClick={() => setPage('about')}
            style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', background: 'rgb(var(--accent))', color: '#fff', border: 'none', cursor: 'pointer' }}>
            View update
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar page={page} setPage={setPage} status={status} onSettings={() => setSettingsOpen(true)} />
        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {status.message && page !== 'setup' && (
            <div style={{ flexShrink: 0, padding: '6px 16px', fontSize: 11, color: 'rgb(var(--fg-muted))', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgb(var(--border))' }}>
              {status.message}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflowY: page === 'evaluation' ? 'hidden' : 'auto' }}>
            {page === 'evaluation' && <EvaluationPage ev={ev} pos={pos} status={status} onOpenSetup={() => setPage('setup')} />}
            {page === 'setup' && <SetupPage status={status} />}
            {page === 'about' && <AboutPage updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} />}
          </div>
        </main>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
