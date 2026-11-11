import { SettingGroups } from '../components/controls/SettingInput'
import { SETTINGS_GROUPS } from '../data/settingControls'

export default function EnginePage({ settings, onChange }) {
  if (!settings) return <div style={{ padding: 24, color: 'rgb(var(--fg-dim))', fontSize: 13 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <SettingGroups groups={SETTINGS_GROUPS.engine} settings={settings} onChange={onChange} labelWidth={130} rowPadding={12} />

      <p style={{ margin: '4px 2px', fontSize: 12, color: 'rgb(var(--fg-dim))', lineHeight: 1.6 }}>
        Depth, alternative arrows, auto-move and overlay/in-page rendering live on the
        <span style={{ color: 'rgb(var(--fg-muted))' }}> Game tab</span>.
      </p>
    </div>
  )
}
