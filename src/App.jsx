import { useEffect, useState, useRef } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import EvaluationPage from './pages/EvaluationPage'
import SetupPage from './pages/SetupPage'
import AboutPage from './pages/AboutPage'

const piecesKey = (fen) => (fen ? fen.split(' ')[0] : '')

export default function App() {
  const [status, setStatus] = useState({ stockfishOk: false, stockfishState: 'starting', overlayOk: false, extensionConnected: false, extensionUpdateAvailable: false, chessConnected: false, chessSite: null, message: '' })
  const [ev, setEv] = useState(null)
  const [pos, setPos] = useState(null)        // { fen, flipped } — authoritative current position
  const [page, setPage] = useState('evaluation')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null)
  const [settings, setSettings] = useState({ game: null, engine: null })
  const [shortcutIds, setShortcutIds] = useState(null)
  const [shortcutError, setShortcutError] = useState('')
  const posRef = useRef(null)

  useEffect(() => {
    let mounted = true
    const api = window.chessist
    const load = (scope, read) => read().then(values => {
      if (mounted) setSettings(previous => ({ ...previous, [scope]: values }))
    }).catch(() => {})
    load('game', api.getGameSettings)
    load('engine', api.getEngineSettings)
    api.getSidebarShortcuts().then(ids => {
      if (mounted) setShortcutIds(ids)
    }).catch(() => {
      if (mounted) setShortcutError('Could not load shortcuts.')
    })
    return () => { mounted = false }
  }, [])

  function changeSetting(scope, key, value) {
    const api = window.chessist
    const previousValue = settings[scope][key]
    setSettings(previous => ({ ...previous, [scope]: { ...previous[scope], [key]: value } }))
    const write = scope === 'game' ? api.setGameOption : api.setEngineOption
    write(key, value).catch(() => {
      setSettings(previous => previous[scope][key] !== value ? previous : {
        ...previous, [scope]: { ...previous[scope], [key]: previousValue },
      })
    })
  }

  function changeShortcuts(ids) {
    const previousIds = shortcutIds
    setShortcutError('')
    setShortcutIds(ids)
    window.chessist.setSidebarShortcuts(ids).then(saved => {
      setShortcutIds(current => current === ids ? saved : current)
    }).catch(() => {
      setShortcutIds(current => current === ids ? previousIds : current)
      setShortcutError('Could not save shortcuts.')
    })
  }

  useEffect(() => {
    window.chessist.getStatus().then(setStatus)
    const offS = window.chessist.onStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.stockfishState !== 'ready') setEv(null)
    })
    const offP = window.chessist.onPosition?.((p) => {
      posRef.current = p
      setPos(previous => previous?.fen === p?.fen && previous?.flipped === p?.flipped ? previous : p)
    })
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
        <Sidebar page={page} setPage={setPage} status={status} onSettings={() => setSettingsOpen(true)}
          settings={settings} shortcutIds={shortcutIds} shortcutError={shortcutError}
          onSettingChange={changeSetting} onShortcutsChange={changeShortcuts} />
        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {status.message && page !== 'setup' && (
            <div style={{ flexShrink: 0, padding: '6px 16px', fontSize: 11, color: 'rgb(var(--fg-muted))', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid rgb(var(--border))' }}>
              {status.message}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflowY: page === 'evaluation' ? 'hidden' : 'auto' }}>
            {page === 'evaluation' && <EvaluationPage ev={ev} pos={pos} status={status} onOpenSetup={() => setPage('setup')} />}
            {page === 'setup' && <SetupPage status={status} />}
            <div hidden={page !== 'about'}>
              <AboutPage updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} />
            </div>
          </div>
        </main>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)}
        gameSettings={settings.game} engineSettings={settings.engine}
        onGameChange={(key, value) => changeSetting('game', key, value)}
        onEngineChange={(key, value) => changeSetting('engine', key, value)} />}
    </div>
  )
}
