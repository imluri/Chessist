import Check from './Check'
import Slider from './Slider'
import { formatSettingValue } from '../../data/settingControls'

export default function SettingInput({ setting, values, onChange, compact = false }) {
  const { key, label, type, options, min, max, step, disabledWhen, describeValue } = setting
  const value = values?.[key]
  const disabled = !values || !!disabledWhen?.(values)

  if (type === 'toggle') {
    const checkbox = <Check label={label} checked={!!value} disabled={disabled} onChange={onChange} />
    if (compact || !describeValue) return checkbox

    return (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12, color: 'rgb(var(--fg-muted))' }}>
        {checkbox}
        {describeValue(value)}
      </label>
    )
  }

  if (type === 'range') {
    return <Slider label={label} value={value ?? min} min={min} max={max} step={step} disabled={disabled} onChange={onChange} />
  }

  if (compact) {
    return (
      <select
        aria-label={label}
        disabled={disabled}
        value={value ?? options[0].value}
        onChange={event => onChange(event.target.value)}
        style={{
          width: '100%', padding: '4px 6px', fontSize: 12, colorScheme: 'dark', color: 'rgb(var(--fg))',
          background: 'rgb(var(--bg))', border: '1px solid rgb(var(--border))', borderRadius: 'var(--radius-sm)',
        }}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  }

  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', border: '1px solid rgb(var(--border))', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      {options.map(option => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          style={{
            padding: '5px 12px', fontSize: 12, cursor: 'pointer', border: 'none',
            background: value === option.value ? 'rgb(var(--accent))' : 'transparent',
            color: value === option.value ? '#fff' : 'rgb(var(--fg-muted))',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingGroups({ groups, settings, onChange, labelWidth = 150, rowPadding = 11 }) {
  return groups.map(({ title, settings: controls }) => (
    <div className="scard" key={title}>
      <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', color: 'rgb(var(--fg-muted))', padding: '10px 0 2px' }}>{title.toUpperCase()}</div>
      {controls.map(setting => {
        const value = setting.type === 'range' ? formatSettingValue(setting, settings[setting.key]) : undefined
        return (
          <div className="srow" key={setting.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${rowPadding}px 0` }}>
            <span style={{ width: labelWidth, fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{setting.label}</span>
            <div style={{ flex: 1 }}>
              <SettingInput setting={setting} values={settings} onChange={value => onChange(setting.key, value)} />
            </div>
            {value !== undefined && (
              <span style={{ width: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'rgb(var(--fg-muted))' }}>{value}</span>
            )}
          </div>
        )
      })}
    </div>
  ))
}
