import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopShell from './DesktopShell'
import SettingsPanel from './SettingsPanel'
import { defaults, groups } from './demoSettings'
import { Icon } from './icons'
import './styles.css'

const storageKey = 'desktop-template.preferences'
const brand = { name: 'Workspace', caption: 'Desktop template', mark: <Icon name="brand" size={20} /> }
const items = [
  { id: 'overview', label: 'Overview', icon: <Icon name="home" /> },
  { id: 'settings', label: 'Settings', icon: <Icon name="settings" /> },
  { id: 'about', label: 'About', icon: <Icon name="info" /> },
]

function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey))
    return { ...defaults, ...stored }
  } catch {
    return { ...defaults }
  }
}

function App() {
  const [saved, setSaved] = useState(loadPreferences)
  const [draft, setDraft] = useState(saved)
  const [page, setPage] = useState('settings')
  const [group, setGroup] = useState('appearance')
  const [notice, setNotice] = useState('')
  const dirty = Object.keys(defaults).some(key => draft[key] !== saved[key])
  const limit = draft.maxRecentItems
  const valid = draft.workspace.trim() !== '' && Number.isInteger(limit) && limit >= 1 && limit <= 50

  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => {
      const theme = draft.theme === 'system' ? scheme.matches ? 'dark' : 'light' : draft.theme
      document.documentElement.dataset.theme = theme
    }
    syncTheme()
    scheme.addEventListener('change', syncTheme)
    return () => scheme.removeEventListener('change', syncTheme)
  }, [draft.theme])

  useEffect(() => {
    document.documentElement.dataset.accent = draft.accent.toLowerCase()
  }, [draft.accent])

  function updateValue(id, value) {
    setNotice('')
    setDraft(current => ({ ...current, [id]: value }))
  }

  function save() {
    if (!valid) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft))
      setSaved(draft)
      setNotice('Settings saved.')
    } catch {
      setNotice('Could not save settings in this window.')
    }
  }

  const workspace = draft.workspace.trim() || defaults.workspace
  const footer = page === 'settings' && (
    <footer className="action-bar">
      <div className="action-bar-content">
        <button type="button" className="button button-plain" onClick={() => {
          setDraft({ ...defaults })
          setNotice('')
        }}><Icon name="reset" size={16} /> Restore defaults</button>
        <div className="save-actions">
          <span className="save-message" role="status">{notice || (!valid ? 'Enter a workspace name and a recent item limit from 1 to 50.' : dirty ? 'Unsaved changes' : 'No unsaved changes')}</span>
          <button type="button" className="button button-primary" disabled={!dirty || !valid} onClick={save}>Save changes</button>
        </div>
      </div>
    </footer>
  )

  return (
    <DesktopShell
      brand={brand} items={items} page={page} onNavigate={setPage}
      windowControls={window.desktopWindow} footer={footer}
      sidebarFooter={<div className="workspace">
        <div className="workspace-avatar" aria-hidden="true">{workspace.slice(0, 1).toUpperCase()}</div>
        <div className="workspace-copy"><strong title={workspace}>{workspace}</strong><span>Local workspace</span></div>
      </div>}
    >
      <div className={`page-content${draft.compact ? ' page-content--compact' : ''}`} style={{ '--ui-text-scale': draft.scale / 100 }}>
        {page === 'settings' && <>
          <div className="page-heading">
            <h1>Settings</h1>
            <p>Customize how your workspace looks and behaves.</p>
          </div>
          <SettingsPanel groups={groups} values={draft} onChange={updateValue} activeGroup={group} onGroupChange={setGroup} />
        </>}
        {page === 'overview' && <>
          <div className="page-heading"><h1>{workspace}</h1><p>Your desktop workspace.</p></div>
          <section className="setting-section welcome-card">
            <div className="brand-mark" aria-hidden="true"><Icon name="settings" size={20} /></div>
            <h2>Make it yours</h2>
            <p>Choose a theme, adjust the layout, or change your workspace name.</p>
            <button type="button" className="button button-primary" onClick={() => setPage('settings')}>Open Settings <Icon name="arrow" size={16} /></button>
          </section>
        </>}
        {page === 'about' && <>
          <div className="page-heading"><h1>About</h1><p>Workspace desktop template</p></div>
          <section className="setting-section about-card">
            <h2>Version 3.0.0 preview</h2>
            <p>Built with Bun, React, and Electron. This preview stores preferences locally. Startup and notification settings are examples.</p>
          </section>
        </>}
      </div>
    </DesktopShell>
  )
}

createRoot(document.getElementById('root')).render(<App />)
