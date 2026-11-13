import { useState } from 'react'
import SettingsPanel from '../../ui-template/src/SettingsPanel'
import { formatSettingValue, SETTINGS_GROUPS } from '../data/settingControls'
import './ChessistSettings.css'

function settingsGroup(id, label, settings) {
  return {
    id,
    label,
    sections: SETTINGS_GROUPS[id].map(({ title, settings: controls }) => ({
      id: title,
      title,
      fields: controls.map(setting => ({
        id: setting.key,
        label: setting.label,
        type: { toggle: 'switch', range: 'range', choice: 'radio' }[setting.type],
        min: setting.min,
        max: setting.max,
        step: setting.step,
        options: setting.options,
        disabled: !settings || !!setting.disabledWhen?.(settings),
        description: settings && setting.describeValue?.(settings[setting.key]),
        formatValue: setting.type === 'range' ? value => formatSettingValue(setting, value) : undefined,
      })),
    })),
  }
}

function DeveloperSettings({ onToggleDevTools }) {
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      setOpen(await onToggleDevTools())
    } catch {
      setError('Could not toggle Developer Tools.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="setting-section">
      <header className="setting-section-heading">
        <h2>Developer Tools</h2>
        <p>Inspect the renderer and view console logs in Chrome DevTools.</p>
      </header>
      <div className="chessist-developer-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={toggle}>
          {open === null ? 'Toggle DevTools' : open ? 'Close DevTools' : 'Open DevTools'}
        </button>
        {error && <p className="setting-description" role="alert">{error}</p>}
      </div>
    </section>
  )
}

export default function ChessistSettings({
  gameSettings,
  engineSettings,
  onGameChange,
  onEngineChange,
  loadError,
  windowApi = window.chessist,
}) {
  const [group, setGroup] = useState('game')
  const values = group === 'game' ? gameSettings : engineSettings
  const groups = [
    settingsGroup('game', 'Game', gameSettings),
    settingsGroup('engine', 'Engine', engineSettings),
    { id: 'developer', label: 'Developer', sections: [] },
  ]

  function renderGroupContent({ id }) {
    if (id === 'developer') return <DeveloperSettings onToggleDevTools={() => windowApi.toggleDevTools()} />
    if (!values) return <p className="chessist-settings-loading" role="status">{loadError || 'Loading settings…'}</p>
    return null
  }

  return (
    <div className="page-content chessist-settings">
      <header className="page-heading">
        <h1>Settings</h1>
        <p>Customize game analysis, display, and Stockfish.</p>
      </header>
      <SettingsPanel groups={groups} values={values ?? {}} activeGroup={group} onGroupChange={setGroup}
        onChange={group === 'game' ? onGameChange : onEngineChange} renderGroupContent={renderGroupContent} />
    </div>
  )
}
