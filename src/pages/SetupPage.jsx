import { useEffect, useState } from 'react'

const btn = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)',
  background: 'rgb(var(--bg))', color: 'rgb(var(--fg))',
  border: '1px solid rgb(var(--border))', cursor: 'pointer',
}

const STATUS = {
  ok:      { color: 'rgb(var(--status-green))',  glow: '0 0 6px rgba(34,197,94,0.7)' },
  working: { color: 'rgb(var(--status-yellow))', glow: '0 0 6px rgba(234,179,8,0.7)' },
  error:   { color: 'rgb(var(--status-red))',    glow: 'none' },
  off:     { color: 'rgb(var(--fg-dim))',        glow: 'none' },
}

// A self-contained module "window": header (title + status) and a body.
function ModuleCard({ title, state, statusLabel, children }) {
  const s = STATUS[state] || STATUS.off
  return (
    <div style={{ marginBottom: 14, border: '1px solid rgb(var(--border))', background: 'rgb(var(--surface))', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, boxShadow: s.glow, flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: s.color }}>{statusLabel}</span>
      </div>
      <div style={{ borderTop: '1px solid rgb(var(--border))', padding: 14 }}>{children}</div>
    </div>
  )
}

function StockfishModule({ status }) {
  const [busy, setBusy] = useState(false)
  const redownload = async () => {
    setBusy(true)
    try { await window.chessist.redownloadStockfish() } finally { setBusy(false) }
  }
  const { stockfishState, message } = status
  const failed = stockfishState === 'error'
  const downloading = stockfishState === 'downloading'
  const state = failed ? 'error' : stockfishState === 'ready' ? 'ok' : 'working'
  const disabled = busy || downloading

  return (
    <ModuleCard title="Stockfish engine" state={state} statusLabel={failed ? 'unavailable' : stockfishState}>
      <p style={{ fontSize: 12, color: 'rgb(var(--fg-muted))', lineHeight: 1.6, marginBottom: 12 }}>
        Native Stockfish powers analysis. It's downloaded automatically on first run and stored with the app.
      </p>
      {(downloading || failed) && message && (
        <p role="status" style={{ fontSize: 12, color: failed ? STATUS.error.color : 'rgb(var(--fg-muted))', lineHeight: 1.6, marginBottom: 12 }}>
          {message}
        </p>
      )}
      <button onClick={redownload} disabled={disabled} style={{ ...btn, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}>
        {busy ? 'Re-downloading…' : 'Re-download Stockfish'}
      </button>
    </ModuleCard>
  )
}

function OverlayModule({ status }) {
  const ok = status.overlayOk
  return (
    <ModuleCard title="Overlay" state={ok ? 'ok' : 'off'} statusLabel={ok ? 'running' : 'unavailable'}>
      <p style={{ fontSize: 12, color: 'rgb(var(--fg-muted))', lineHeight: 1.6 }}>
        {ok
          ? 'The transparent, screen-capture-invisible overlay helper is running. Pick "Overlay" render mode on the Game tab to draw on the board.'
          : 'Overlay helper not found. Build it with "npm run build:overlay" (dev) or reinstall the app. The In-page and App render modes still work without it.'}
      </p>
    </ModuleCard>
  )
}

function ExtensionModule({ status }) {
  const [extPath, setExtPath] = useState('')
  const [ffPath, setFfPath] = useState('')
  const [browser, setBrowser] = useState('chromium')   // 'chromium' | 'firefox'
  const [copied, setCopied] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  useEffect(() => {
    window.chessist.getExtensionPath().then(setExtPath)
    window.chessist.getFirefoxPath?.().then(setFfPath)
  }, [])

  const copy = (text, tag) => { window.chessist.copyText(text); setCopied(tag); setTimeout(() => setCopied(''), 1500) }
  const connected = status.extensionConnected
  const needsUpdate = status.extensionUpdateAvailable

  const Step = ({ n, children }) => (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 12, color: 'rgb(var(--fg-muted))', lineHeight: 1.6 }}>
      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: '1px solid rgb(var(--border))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'rgb(var(--fg))' }}>{n}</span>
      <span>{children}</span>
    </div>
  )
  const PathBox = ({ path }) => path ? (
    <div style={{ margin: '10px 0', padding: '8px 10px', background: 'rgb(var(--bg))', border: '1px solid rgb(var(--border))', borderRadius: 'var(--radius-sm)', fontFamily: 'monospace', fontSize: 11, color: 'rgb(var(--fg-muted))', wordBreak: 'break-all' }}>
      {path}
    </div>
  ) : null
  const Tab = ({ id, children }) => (
    <button onClick={() => setBrowser(id)} style={{
      ...btn, background: browser === id ? 'rgb(var(--surface))' : 'transparent',
      borderColor: browser === id ? 'rgb(var(--accent))' : 'rgb(var(--border))',
      color: browser === id ? 'rgb(var(--fg))' : 'rgb(var(--fg-muted))',
    }}>{children}</button>
  )

  return (
    <ModuleCard title="Browser extension" state={status.wsError ? 'error' : needsUpdate ? 'working' : connected ? 'ok' : 'off'}
      statusLabel={status.wsError ? 'connection error' : needsUpdate ? 'update available' : connected ? 'connected' : 'not connected'}>
      {status.wsError && <p role="status" style={{ color: STATUS.error.color, fontSize: 12, marginBottom: 10 }}>
        Could not start the local connection. {status.wsError}
      </p>}
      {connected && (
        <div style={{ marginBottom: !needsUpdate && !showInstructions ? 0 : 10 }}>
          <p style={{ fontSize: 12, color: 'rgb(var(--fg-muted))', lineHeight: 1.6 }}>
            {needsUpdate
              ? 'If Chessist still shows an older version in your browser, reload the extension. If the version stays the same, load the bundled folder below.'
              : 'The extension is connected. Open or refresh a chess tab on Chess.com or Lichess to start analysis.'}
          </p>
          {!needsUpdate && (
            <button style={{ ...btn, marginTop: 8 }} onClick={() => setShowInstructions(!showInstructions)} aria-expanded={showInstructions}>
              {showInstructions ? 'Hide setup instructions' : 'Show setup instructions'}
            </button>
          )}
        </div>
      )}
      {(!connected || needsUpdate || showInstructions) && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <Tab id="chromium">Chrome / Brave / Edge</Tab>
            <Tab id="firefox">Firefox</Tab>
          </div>

          {browser === 'chromium' ? (
            <>
              <Step n={1}>Open <code style={{ color: 'rgb(var(--fg))' }}>chrome://extensions</code> in Chrome, Brave, or Edge.</Step>
              <Step n={2}>Turn on <strong style={{ color: 'rgb(var(--fg))' }}>Developer mode</strong> (top-right toggle).</Step>
              <Step n={3}>Click <strong style={{ color: 'rgb(var(--fg))' }}>Load unpacked</strong> and select the folder below.</Step>
              <PathBox path={extPath} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button style={btn} onClick={() => window.chessist.revealExtensionFolder()}>Open folder</button>
                <button style={btn} onClick={() => copy(extPath, 'path')}>{copied === 'path' ? 'Copied ✓' : 'Copy path'}</button>
                <button style={btn} onClick={() => copy('chrome://extensions', 'url')}>{copied === 'url' ? 'Copied ✓' : 'Copy chrome://extensions'}</button>
              </div>
              <p style={{ marginTop: 10, fontSize: 11, color: 'rgb(var(--fg-dim))' }}>
                Browsers block opening <code>chrome://</code> links from outside — copy and paste it into the address bar.
              </p>
            </>
          ) : (
            <>
              <Step n={1}>Open <code style={{ color: 'rgb(var(--fg))' }}>about:debugging#/runtime/this-firefox</code> in Firefox 128+.</Step>
              <Step n={2}>Click <strong style={{ color: 'rgb(var(--fg))' }}>Load Temporary Add-on…</strong></Step>
              <Step n={3}>Open the folder below and select its <strong style={{ color: 'rgb(var(--fg))' }}>manifest.json</strong>.</Step>
              <PathBox path={ffPath} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button style={btn} onClick={() => window.chessist.revealFirefoxFolder()}>Open folder</button>
                <button style={btn} onClick={() => copy(ffPath, 'ffpath')}>{copied === 'ffpath' ? 'Copied ✓' : 'Copy path'}</button>
                <button style={btn} onClick={() => copy('about:debugging#/runtime/this-firefox', 'ffurl')}>{copied === 'ffurl' ? 'Copied ✓' : 'Copy about:debugging'}</button>
              </div>
              <p style={{ marginTop: 10, fontSize: 11, color: 'rgb(var(--fg-dim))' }}>
                Firefox removes temporary add-ons when it restarts — re-add it after restarting. If the folder is empty, run <code>npm run build:firefox</code> (dev only).
              </p>
            </>
          )}
        </>
      )}
    </ModuleCard>
  )
}

export default function SetupPage({ status }) {
  return (
    <div className="page-content">
      <header className="page-heading">
        <h1>Setup</h1>
        <p>Manage Stockfish, the overlay, and your browser extension.</p>
      </header>
      <StockfishModule status={status} />
      <OverlayModule status={status} />
      <ExtensionModule status={status} />
    </div>
  )
}
