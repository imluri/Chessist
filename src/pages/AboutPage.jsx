import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo.png'
import Check from '../components/controls/Check'

const VERSION = '2.1.0'
// Baked at build time when git is available (see vite.config.js). Empty for source-ZIP builds.
const BUILD_SHA = (typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : '')
const RELEASES_URL = 'https://github.com/imluri/Chessist/releases'

function Link({ href, children }) {
  return (
    <button
      onClick={() => window.chessist.openExternal(href)}
      style={{ background: 'none', border: 'none', color: 'rgb(var(--accent))', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}
    >
      {children}
    </button>
  )
}

const btn = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)',
  background: 'rgb(var(--accent))', color: '#fff', border: 'none', cursor: 'pointer',
}
const btnGhost = { ...btn, background: 'rgb(var(--surface))', color: 'rgb(var(--fg))', border: '1px solid rgb(var(--border))' }

function Updates({ status, onChange }) {
  const [busy, setBusy] = useState(false)   // checking
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [beta, setBetaState] = useState(false)
  const [log, setLog] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const logRef = useRef(null)

  useEffect(() => {
    window.chessist.getBeta().then(setBetaState).catch(() => {})
    return window.chessist.onUpdateLog((line) => {
      const progress = /^Downloading update…(?: (\d+)%)?$/.exec(line.trim())
      if (progress) {
        setDownloadProgress(Number(progress[1] ?? 0))
      } else {
        setLog(prev => prev + line)
      }
    })
  }, [])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [log])

  const check = async () => {
    setBusy(true)
    setApplyError('')
    try {
      onChange(await window.chessist.checkUpdate())
    } catch {
      onChange({ installer: status?.installer, error: 'Could not check for updates. Try again.' })
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    setApplying(true)
    setApplyError('')
    setLog('')
    setDownloadProgress(0)
    try {
      const result = await window.chessist.applyUpdate()
      if (!result.ok) {
        setApplyError(result.error || result.message || (result.step
          ? `Update failed at ${result.step}.`
          : 'Could not install the update. Try again.'))
        setApplying(false)
      }
    } catch {
      setApplyError('Could not install the update. Try again.')
      setApplying(false)
    }
  }
  const toggleBeta = async (v) => {
    setBetaState(v)
    await window.chessist.setBeta(v)
    check()   // re-evaluate against the new channel
  }

  let line = 'Checking…'
  let color = 'rgb(var(--fg-muted))'
  let manualUpdate = false
  if (status) {
    if (status.error) { line = status.error; color = 'rgb(var(--status-red))' }
    else if (status.unsupported) { line = 'Updates apply to git installs only.'; color = 'rgb(var(--fg-dim))' }
    else if (status.noReleases) { line = 'No stable release published yet.'; color = 'rgb(var(--fg-dim))' }
    else if (status.manual) {
      let avail = status.available
      if (status.channel === 'beta') avail = !!BUILD_SHA && !!status.latestSha && BUILD_SHA !== status.latestSha
      if (avail) {
        manualUpdate = true
        line = status.channel === 'beta'
          ? 'New commit available on main — download the latest build.'
          : status.installer
            ? `Update available — ${status.tag}. See the release for download options.`
            : `Update available — ${status.tag}. Download the latest build.`
        color = 'rgb(var(--status-yellow))'
      } else { line = 'You are on the latest version.'; color = 'rgb(var(--status-green))' }
    }
    else if (status.available && status.channel === 'beta') { line = `Update available — ${status.behind} commit${status.behind === 1 ? '' : 's'} behind.`; color = 'rgb(var(--status-yellow))' }
    else if (status.available) { line = `Update available — ${status.tag}.`; color = 'rgb(var(--status-yellow))' }
    else { line = 'You are on the latest version.'; color = 'rgb(var(--status-green))' }
  }

  const channelName = status?.channel || (beta ? 'beta' : 'stable')
  const head = status?.head || BUILD_SHA
  const canApply = status?.available && !status.manual && (!status.installer || status.canApply)
  const releaseUrl = status?.tag ? `${RELEASES_URL}/tag/${encodeURIComponent(status.tag)}` : RELEASES_URL
  const installerStatus = applying && status?.installer ? log.trim() : null

  return (
    <div className="scard" style={{ padding: 14, marginTop: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', color: 'rgb(var(--fg-muted))', marginBottom: 8 }}>UPDATES</div>

      {/* Always show what you're on. */}
      <div style={{ fontSize: 12, color: 'rgb(var(--fg-muted))', fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
        Installed: <span style={{ color: 'rgb(var(--fg))' }}>v{VERSION}</span>
        {head && <span> · <span style={{ fontFamily: 'monospace' }}>{head}</span></span>}
        {' '}· <span>{channelName} channel</span>
      </div>

      {installerStatus === '' ? (
        <progress className="update-progress" aria-label="Downloading update" value={downloadProgress} max={100} />
      ) : (
        <div role="status" style={{ fontSize: 12, color: applyError ? 'rgb(var(--status-red))' : color, marginBottom: 12 }}>
          {applyError || (applying ? installerStatus || 'Updating…' : line)}
        </div>
      )}

      {status && !status.installer && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: 'pointer' }}>
          <Check checked={beta} onChange={toggleBeta} disabled={busy || applying} />
          <span style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>Beta channel</span>
            <span style={{ color: 'rgb(var(--fg-dim))' }}> — update on every commit (off = released versions only)</span>
          </span>
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(manualUpdate || (applyError && status?.installer && status.available)) && (
          <button style={btn} onClick={() => window.chessist.openExternal(releaseUrl)}>{status.installer ? 'View release' : 'Download update'}</button>
        )}
        {canApply && !applying && (
          <button style={btn} disabled={busy} onClick={apply}>Update &amp; restart</button>
        )}
        <button style={btnGhost} disabled={busy || applying} onClick={check}>
          {busy ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {!status?.installer && (applying || log) && (
        <pre ref={logRef} style={{
          marginTop: 12, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: 'rgb(var(--bg))', border: '1px solid rgb(var(--border))', borderRadius: 'var(--radius-sm)',
          padding: 10, fontSize: 11, fontFamily: 'monospace', color: 'rgb(var(--fg-muted))',
        }}>{log || ' '}</pre>
      )}
    </div>
  )
}

export default function AboutPage({ updateStatus, onUpdateStatus }) {
  return (
    <div style={{ padding: 16, fontSize: 13, lineHeight: 1.9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '0 8px' }}>
        <img src={logo} alt="" width={40} height={40} style={{ display: 'block', borderRadius: 8 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '0.08em' }}>CHESSIST</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--fg-muted))' }}>v{VERSION}</span>
        </div>
      </div>
      <p style={{ color: 'rgb(var(--fg-muted))', margin: '0 8px 14px' }}>
        Live Stockfish evaluation for Chess.com and Lichess — a desktop app with a transparent,
        screen-capture-invisible board overlay.
      </p>
      <div style={{ display: 'grid', gap: 4, padding: '0 8px' }}>
        <Link href="https://github.com/imluri/Chessist">GitHub repository</Link>
        <Link href="https://stockfishchess.org/">Stockfish (GPL)</Link>
      </div>

      <Updates status={updateStatus} onChange={onUpdateStatus} />

      <p style={{ margin: '16px 8px 0', fontSize: 12, color: 'rgb(var(--fg-dim))' }}>
        Created by imluri · MIT licensed (app + extension) · Stockfish is GPL, downloaded at first run.
      </p>
    </div>
  )
}
