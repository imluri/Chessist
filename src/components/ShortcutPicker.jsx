import { useEffect, useRef, useState } from 'react'
import { SETTING_SHORTCUTS } from '../data/settingControls'

const GROUPS = [{ id: 'game', label: 'Game' }, { id: 'engine', label: 'Engine' }]

export default function ShortcutPicker({ selectedIds, error, onChange, onClose }) {
  const [query, setQuery] = useState('')
  const dialog = useRef(null)
  const search = useRef(null)
  const results = SETTING_SHORTCUTS.filter(setting => setting.label.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    search.current.focus()
    return () => element.close()
  }, [])

  return (
    <dialog ref={dialog} className="shortcut-picker" aria-labelledby="shortcut-picker-title"
      onCancel={event => { event.preventDefault(); onClose() }}>
      <header className="shortcut-picker-header">
        <h2 id="shortcut-picker-title">Add shortcuts</h2>
        <button type="button" className="shortcut-picker-close" aria-label="Close shortcut picker" onClick={onClose}>×</button>
      </header>
      <input ref={search} type="search" aria-label="Find a setting" placeholder="Find a setting…" value={query}
        onChange={event => setQuery(event.target.value)} />
      <div className="shortcut-picker-results">
        {GROUPS.map(group => {
          const settings = results.filter(setting => setting.scope === group.id)
          if (!settings.length) return null
          return (
            <section key={group.id} aria-label={group.label}>
              <h3>{group.label}</h3>
              {settings.map(setting => {
                const selected = selectedIds.includes(setting.id)
                return (
                  <label key={setting.id} className="shortcut-picker-option">
                    <span>{setting.label}</span>
                    <input type="checkbox" checked={selected} onChange={event => onChange(event.target.checked
                      ? [...selectedIds, setting.id] : selectedIds.filter(id => id !== setting.id))} />
                  </label>
                )
              })}
            </section>
          )
        })}
        {!results.length && <p className="shortcut-picker-empty">No matching settings.</p>}
      </div>
      <footer className="shortcut-picker-footer">
        {error && <p className="shortcut-error" role="status">{error}</p>}
        <button type="button" onClick={onClose}>Done</button>
      </footer>
    </dialog>
  )
}
