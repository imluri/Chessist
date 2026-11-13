import { useRef, useState } from 'react'
import SettingInput from './controls/SettingInput'
import ShortcutPicker from './ShortcutPicker'
import { SETTING_SHORTCUTS, formatSettingValue } from '../data/settingControls'

const SHORTCUTS_BY_ID = new Map(SETTING_SHORTCUTS.map(setting => [setting.id, setting]))

export default function SidebarShortcuts({ settings, shortcutIds, shortcutError, onSettingChange, onShortcutsChange }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const addButton = useRef(null)
  return (
    <>
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
      {pickerOpen && <ShortcutPicker selectedIds={shortcutIds} error={shortcutError} onChange={onShortcutsChange}
        onClose={() => setPickerOpen(false)} />}
    </>
  )
}
