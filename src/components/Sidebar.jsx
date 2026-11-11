import { useRef, useState } from 'react'
import { IconEval, IconGame, IconSetup, IconAbout } from './icons'
import SettingInput from './controls/SettingInput'
import ShortcutPicker from './ShortcutPicker'
import { SETTING_SHORTCUTS, formatSettingValue } from '../data/settingControls'

const ITEMS = [
  { id: 'evaluation', label: 'Evaluation', Icon: IconEval },
  { id: 'setup',      label: 'Setup',      Icon: IconSetup },
  { id: 'about',      label: 'About',      Icon: IconAbout },
]

const SHORTCUTS_BY_ID = new Map(SETTING_SHORTCUTS.map(setting => [setting.id, setting]))

export default function Sidebar({ page, setPage, status, onSettings, settings, shortcutIds, shortcutError, onSettingChange, onShortcutsChange }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const addButton = useRef(null)
  const ready = status.stockfishOk && status.extensionConnected
  const dotColor = ready ? 'rgb(var(--status-green))' : 'rgb(var(--status-yellow))'
  const dotGlow = ready ? '0 0 6px rgba(34,197,94,0.7)' : '0 0 6px rgba(234,179,8,0.7)'

  return (
    <aside style={{
      width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgb(var(--border))', background: 'rgb(var(--bg))',
    }}>
      <nav aria-label="Main navigation" style={{ padding: '8px 0 2px' }}>
        {ITEMS.map(({ id, label, Icon }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              aria-current={active ? 'page' : undefined}
              className={active ? 'nav-item active' : 'nav-item'}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 16px', background: active ? 'rgb(var(--surface))' : 'transparent',
                border: 'none', borderLeft: active ? '2px solid rgb(var(--accent))' : '2px solid transparent',
                color: active ? 'rgb(var(--fg))' : 'rgb(var(--fg-muted))',
                cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500, textAlign: 'left',
              }}
            >
              <Icon style={{ width: 16, height: 16, color: active ? 'rgb(var(--accent))' : 'rgb(var(--fg-dim))' }} />
              {label}
            </button>
          )
        })}
      </nav>
      <button ref={addButton} type="button" className="sidebar-add-shortcut" aria-haspopup="dialog"
        disabled={!shortcutIds} onClick={() => setPickerOpen(true)}>
        <span aria-hidden="true">+</span> Add shortcuts
      </button>
      <section className="sidebar-shortcuts" aria-label="Setting shortcuts">
        {shortcutIds?.map(id => {
          const setting = SHORTCUTS_BY_ID.get(id)
          if (!setting || !settings[setting.scope]) return null
          const values = settings[setting.scope]
          const isToggle = setting.type === 'toggle'
          return (
            <div key={id} className="sidebar-shortcut">
              <div className="sidebar-shortcut-header">
                <span className="sidebar-shortcut-label">{setting.label}</span>
                {setting.type === 'range' && <span className="sidebar-shortcut-value">{formatSettingValue(setting, values[setting.key])}</span>}
                {isToggle && <SettingInput setting={setting} values={values} compact
                  onChange={value => onSettingChange(setting.scope, setting.key, value)} />}
                <button type="button" className="shortcut-remove" aria-label={`Remove ${setting.label} shortcut`}
                  title={`Remove ${setting.label} shortcut`} onClick={() => {
                    onShortcutsChange(shortcutIds.filter(shortcutId => shortcutId !== id))
                    addButton.current?.focus()
                  }}>×</button>
              </div>
              {!isToggle && <SettingInput setting={setting} values={values} compact
                onChange={value => onSettingChange(setting.scope, setting.key, value)} />}
            </div>
          )
        })}
        {shortcutError && !pickerOpen && <p className="shortcut-error" role="status">{shortcutError}</p>}
      </section>
      <button onClick={onSettings} className="nav-item"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px',
          background: 'transparent', border: 'none', borderLeft: '2px solid transparent',
          borderTop: '1px solid rgb(var(--border))',
          color: 'rgb(var(--fg-muted))', cursor: 'pointer', fontSize: 13, fontWeight: 500, textAlign: 'left',
        }}>
        <IconGame style={{ width: 16, height: 16, color: 'rgb(var(--fg-dim))' }} />
        Settings
      </button>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
        borderTop: '1px solid rgb(var(--border))', fontSize: 11, color: 'rgb(var(--fg-muted))',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
        {ready ? 'ready' : 'setup'}
      </div>
      {pickerOpen && <ShortcutPicker selectedIds={shortcutIds} error={shortcutError} onChange={onShortcutsChange}
        onClose={() => setPickerOpen(false)} />}
    </aside>
  )
}
